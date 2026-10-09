#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { run_invocation } from '#scripts/run/run-invocation'
import { backlog_named } from './backlog-named'
import { backlog_next } from './backlog-next'
import { backlog_plan, type NamedPlan } from './backlog-plan'
import { backlog_plan_read, type OpenListing, type Plan } from './backlog-plan-read'
import { backlog_scope } from './backlog-scope'
import { backlog_waves } from './backlog-waves'

// `josh backlog:plan` — the whole backlog as a plan a person reads before a run starts.
//
// `backlog:next` already answers what may start, and a `backlogrun` acted on that answer one ask at a
// time, so nothing ever showed the shape of the run: the order, which issue waits on which, what is
// waiting on a person, and what the backlog will not run at all. That last one was invisible by
// construction — an issue without `auto-ok` never enters the pool, so silence covered both "not opted
// in" and "not reached yet".
//
// It is a second command rather than a flag on `backlog:next`, because that command's standard output
// is a contract a loop branches on — one bare token per line — and a plan printed there would break
// every consumer of it. What it is *not* is a second implementation: the classification comes from
// `backlog_next.resolve`, so the plan cannot promise an order the run does not take.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

// The keyword `run_invocation` parses a named-issue prefix behind, reused rather than parsing `#N`
// again here so the `0` / leading-zero / safe-integer rules stay single-sourced.
const NAMED_COMMAND = 'backlogrun'
// The flag that runs the named list and stops, mirrored here so the plan the person reads before the
// run shows the same scope the run will take.
const ONLY_FLAG = '--only'
// The flag that renders the run's order wave by wave instead of the pool's sections.
const WAVES_FLAG = '--waves'

const USAGE =
	'Usage: josh backlog:plan [#<issue-number>...] [--only] [--waves] [--exclude <issue-number>[,<issue-number>...]]...'

// The waves play the opted-in pool forward, and a named prefix runs ahead of it one issue at a time —
// an epic among them running its children first — so waves drawn from the pool alone would promise an
// order that invocation does not take.
const WAVES_WITH_NAMED_MESSAGE =
	'`--waves` plans the opted-in backlog alone; drop the named issues (and `--only`) to see its waves.'

// The leading `#N` tokens are the named prefix a `backlogrun #N1 #N2 …` runs before the pool. They are
// read through the invocation grammar so the plan and the run agree on what counts as a named issue.
function named_of(argv: ReadonlyArray<string>): ReadonlyArray<number> {
	return run_invocation.issue_numbers(`${NAMED_COMMAND} ${argv.join(' ')}`) ?? []
}

// The tokens after the named prefix — what the option parser sees, so a `#N` is never read as an
// unknown positional.
function without_named(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	return argv.slice(named_of(argv).length)
}

function has_only_flag(argv: ReadonlyArray<string>): boolean {
	return argv.includes(ONLY_FLAG)
}

// `--only` and `--waves` are stripped before the named block and the options are read, so neither is
// taken for a positional or an unknown option; whether each was present is carried as a boolean.
function without_flags(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	return argv.filter((token) => token !== ONLY_FLAG && token !== WAVES_FLAG)
}

// The one start-time refusal: `--only` with no named issues has nothing to run. `backlog_named` is the
// single source of that decision, so the plan and the run refuse it alike. The refusal turns only on
// whether anything was named, so the items are built with `is_epic: false` — which item is an epic is
// decided by the run at dispatch time, not here.
function only_refusal(named: ReadonlyArray<number>, is_only: boolean): string | undefined {
	const items = named.map((issue) => ({ issue, is_epic: false }))
	const startup = backlog_named.startup(items, is_only)

	return startup.kind === 'refused' ? startup.reason : undefined
}

// A failed open listing is not "nothing is out of scope". Reported rather than rendered around,
// because a confident absence built on a read that failed is worse than no answer.
const OPEN_UNREADABLE_MESSAGE =
	"Could not read this repository's open issues, so the out-of-scope half of the plan cannot be told from an empty one. Check `gh auth status` and ask again."

// A cut listing is a cut *set difference*, which is not the ignorable prefix a display's cap is: an
// open issue past the cut is missing from the out-of-scope section and its title is missing from
// every other one. Reported as a gap, the way `backlog:next` reports its own truncated listings.
const OPEN_TRUNCATED_MESSAGE = `⚠ The open-issue listing stopped at ${String(auto_ok_cli.LISTING_LIMIT)} rows, so the out-of-scope section is partial, some titles are missing, and a blocker that has since closed can still be named. The plan below is incomplete.`

// Which rendering was asked for: the named prefix the sections lead with, or the waves.
interface PlanView {
	named: NamedPlan
	is_waves: boolean
}

function print_plan(plan: Plan, listing: OpenListing, view: PlanView): void {
	const context = backlog_plan_read.context_of(plan, listing)

	if (view.is_waves) {
		console.info(backlog_waves.format_waves(plan.result, context, plan.scope))

		return
	}

	const scope = { repo: plan.repo, exclude: plan.exclude, tracked: plan.tracked }
	const rows = backlog_scope.out_of_scope(listing.rows, plan.result, scope)

	console.info(backlog_plan.format_plan(plan.result, rows, context, view.named))
}

async function report(plan: Plan, view: PlanView): Promise<number> {
	const listing = await backlog_plan_read.fetch_open()

	if (listing === undefined) {
		console.error(OPEN_UNREADABLE_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	if (listing.is_capped) console.error(OPEN_TRUNCATED_MESSAGE)
	print_plan(plan, listing, view)

	return SUCCESS_EXIT_CODE
}

async function run_plan(rest: ReadonlyArray<string>, view: PlanView): Promise<number> {
	const options = auto_ok_cli.parse_options(without_named(rest), USAGE)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const opted_in = await auto_ok_cli.fetch_opted_in()

	if (opted_in.kind !== 'read') {
		console.error(backlog_next.READ_FAILURES[opted_in.kind])

		return FAILURE_EXIT_CODE
	}

	const plan = await backlog_plan_read.classify(opted_in, options.exclude ?? [])

	return plan === undefined ? FAILURE_EXIT_CODE : await report(plan, view)
}

// The start-time refusals, `--only`'s and `--waves`'s, in one place so `run` stays a straight line.
//
// The waves refusal reads the named block from the flag-stripped tokens, so `--waves #5` is refused
// like `#5 --waves` rather than having its `#5` dropped by the option parser.
function refusal_of(
	named: ReadonlyArray<number>,
	rest: ReadonlyArray<string>,
	is_only: boolean,
	is_waves: boolean,
): string | undefined {
	if (!is_waves) return only_refusal(named, is_only)

	return is_only || named_of(rest).length > 0 ? WAVES_WITH_NAMED_MESSAGE : undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const is_only = has_only_flag(argv)
	const is_waves = argv.includes(WAVES_FLAG)
	const rest = without_flags(argv)
	// Read the named block from the *original* argv, so `--only` placed before the `#N` block breaks the
	// leading block exactly as the run grammar does — the plan then refuses an ordering the run refuses,
	// rather than promising a scope the resumed invocation would stop on.
	const named = named_of(argv)
	const refusal = refusal_of(named, rest, is_only, is_waves)

	if (refusal !== undefined) {
		console.error(refusal)

		return FAILURE_EXIT_CODE
	}

	return await run_plan(rest, { named: { issues: named, only: is_only }, is_waves })
}

// `process.exitCode` rather than `process.exit()`, the reason `backlog:next` records: the plan is
// several kilobytes on standard output, and exiting outright can cut the pipe before it has drained.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_plan_cli = {
	OPEN_TRUNCATED_MESSAGE,
	OPEN_UNREADABLE_MESSAGE,
	WAVES_WITH_NAMED_MESSAGE,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_plan_cli }
