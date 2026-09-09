#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/schemas'
import { backlog_next, type OptedIn } from './backlog-next'
import { backlog_plan } from './backlog-plan'
import { backlog_scope } from './backlog-scope'

// `josh backlog:plan` — the whole backlog as a plan a person reads before a run starts
// (joshuafolkken/kit#1652).
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

const USAGE = 'Usage: josh backlog:plan [--exclude <issue-number>[,<issue-number>...]]...'

// A failed open listing is not "nothing is out of scope". Reported rather than rendered around, for
// the reason joshuafolkken/kit#950 records: a confident absence built on a read that failed is worse
// than no answer.
const OPEN_UNREADABLE_MESSAGE =
	"Could not read this repository's open issues, so the out-of-scope half of the plan cannot be told from an empty one. Check `gh auth status` and ask again."

// A cut listing is a cut *set difference*, which is not the ignorable prefix a display's cap is: an
// open issue past the cut is missing from the out-of-scope section and its title is missing from
// every other one. Reported as a gap, the way `backlog:next` reports its own truncated listings.
const OPEN_TRUNCATED_MESSAGE = `⚠ The open-issue listing stopped at ${String(auto_ok_cli.LISTING_LIMIT)} rows, so the out-of-scope section is partial and some titles are missing. The plan below is incomplete.`

interface Plan {
	result: EpicNextResult
	repo: string
	exclude: ReadonlyArray<number>
}

// The listing plus whether it was cut. Carried together because the rows alone cannot say whether
// what is missing from them is absent or merely past the cap.
interface OpenListing {
	rows: ReadonlyArray<OpenIssueData>
	is_capped: boolean
}

// The same reads and the same classification `backlog:next` makes, through the same two functions.
// `undefined` is a failure it has already reported.
async function classify(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
): Promise<Plan | undefined> {
	const context = await backlog_next.context_of(opted_in, exclude)

	if (context === undefined) return undefined

	const result = await backlog_next.resolve(context)

	return result === undefined ? undefined : { result, repo: context.repo, exclude }
}

// Every open issue, read once. It carries both halves the plan needs and the pool does not hold: the
// titles, and the set the out-of-scope rows are subtracted from. One read serves both, so the plan
// costs exactly one `gh` call more than the answer it is rendering.
async function fetch_open(): Promise<OpenListing | undefined> {
	const { json, is_capped } = await git_gh_command.issue_list_recent(auto_ok_cli.LISTING_LIMIT)

	if (json === undefined) return undefined

	const read = read_json_listing(json, open_issue_schema)

	return read.kind === 'read' ? { rows: read.rows, is_capped } : undefined
}

function print_plan(plan: Plan, open_issues: ReadonlyArray<OpenIssueData>): void {
	const scope = { repo: plan.repo, exclude: plan.exclude }
	const rows = backlog_scope.out_of_scope(open_issues, plan.result, scope)
	const context = {
		repo: plan.repo,
		titles: backlog_scope.titles_of(open_issues),
		open_numbers: backlog_scope.open_numbers_of(open_issues),
	}

	console.info(backlog_plan.format_plan(plan.result, rows, context))
}

async function report(plan: Plan): Promise<number> {
	const listing = await fetch_open()

	if (listing === undefined) {
		console.error(OPEN_UNREADABLE_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	if (listing.is_capped) console.error(OPEN_TRUNCATED_MESSAGE)
	print_plan(plan, listing.rows)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = auto_ok_cli.parse_options(argv, USAGE)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const opted_in = await auto_ok_cli.fetch_opted_in()

	if (opted_in.kind !== 'read') {
		console.error(backlog_next.READ_FAILURES[opted_in.kind])

		return FAILURE_EXIT_CODE
	}

	const plan = await classify(opted_in, options.exclude ?? [])

	return plan === undefined ? FAILURE_EXIT_CODE : await report(plan)
}

// `process.exitCode` rather than `process.exit()`, the reason `backlog:next` records: the plan is
// several kilobytes on standard output, and exiting outright can cut the pipe before it has drained.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_plan_cli = {
	OPEN_TRUNCATED_MESSAGE,
	OPEN_UNREADABLE_MESSAGE,
	USAGE,
	classify,
	fetch_open,
	main,
	print_plan,
	report,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_plan_cli }
