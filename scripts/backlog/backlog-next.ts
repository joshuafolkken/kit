import { fileURLToPath } from 'node:url'
import { auto_ok_cli, type OptedInRead, type TrackingRead } from '#scripts/auto-ok/auto-ok-cli'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { epic_bundle_gaps } from '#scripts/epic/epic-bundle-gaps'
import { epic_next } from '#scripts/epic/epic-next'
import { epic_next_read, type EpicRead } from '#scripts/epic/epic-next-read'
import type { EpicView } from '#scripts/epic/epic-next-views'
import { epic_report, type EpicNextResult, type EpicVerdict } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { backlog_pool } from './backlog-pool'

// `josh backlog:next` — what the whole opted-in backlog may run next (joshuafolkken/kit#1630).
//
// The answer used to be split in two, and neither half could give it. `epic:next` has the dependency
// graph and the execution wave, but its input is **one epic's task list**. `auto-ok:next` sees the
// whole backlog, but it orders by the display's newest-first ranking and reads no dependency at all.
// So there was no route that asked the backlog itself what may start.
//
// This command is that route, and it is glue rather than a third implementation: the epic half runs
// through `epic:next`'s own read → classify → report pipeline unchanged, the standalone half through
// `auto-ok:next`'s own listing and runnability rules, and the verdict comes from
// `epic_report.decide_verdict` so it cannot drift from what `epic:next` means by the same word.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const USAGE = 'Usage: josh backlog:next [--exclude <issue-number>[,<issue-number>...]]...'

const REPO_UNREADABLE_MESSAGE =
	'Could not read this repository from `gh`, so an epic child could not be told from an issue elsewhere. That is not "nothing is runnable" — check `gh auth status` and ask again.'

// Why a read of the opted-in listing failed, in `auto-ok:next`'s own words. Reworded here, the two
// commands would explain the same failure differently to the same person.
const READ_FAILURES: Readonly<Record<Exclude<OptedInRead['kind'], 'read'>, string>> = {
	blockers_unreadable: auto_ok_cli.BLOCKERS_UNREADABLE_MESSAGE,
	unexpected_shape: auto_ok_cli.UNEXPECTED_SHAPE_MESSAGE,
	unreadable: auto_ok_cli.UNREADABLE_MESSAGE,
}

// `epic:next`'s verdicts, in this command's spelling.
//
// `complete` becomes `none` because a backlog is never finished the way one epic is — the token says
// "nothing to hand back", which is the same thing `auto-ok:next` prints, so a loop reading either
// command branches on one word. `run` never reaches standard output at all: the numbers do.
const VERDICT_TOKENS: Readonly<Record<EpicVerdict, string>> = {
	complete: auto_ok_cli.NONE_TOKEN,
	error: 'error',
	run: 'run',
	stop: 'stop',
	wait: 'wait',
}

type OptedIn = Extract<OptedInRead, { kind: 'read' }>
type Tracking = Extract<TrackingRead, { kind: 'read' }>

// Everything the answer is assembled from, read once and passed down rather than re-fetched.
interface PoolContext {
	opted_in: OptedIn
	tracking: Tracking
	repo: string
	exclude: ReadonlyArray<number>
}

// One token per line on standard output: the runnable issue numbers of **this** repository, in the
// order they may be started, or the single verdict word when there is nothing to offer here. Every
// explanation is on standard error, so `answers=$(pnpm josh backlog:next)` captures something a loop
// can branch on.
//
// **The tokens are scoped to this repository, which is `epic:next --repo`'s shape exactly.** An epic
// may track a child elsewhere, and a bare number would send the loop reading this to *this*
// repository's issue of that number — a different issue (joshuafolkken/kit#1016). Qualifying it
// instead was tried and is worse: `--exclude` parses bare integers, so a loop feeding a qualified
// token back would be answered with a usage error rather than an exclusion. So a child elsewhere
// stays out of the tokens, and `run` becomes `wait` when this repository has none — the same mapping
// `epic_next.repo_verdict` makes, and for the same reason: the work is real, it is simply not work
// this checkout can start. It is still on standard error, under its own repository and checkout.
function tokens_of(result: EpicNextResult, repo: string): ReadonlyArray<string> {
	if (result.verdict !== 'run') return [VERDICT_TOKENS[result.verdict]]
	const here = epic_report.candidates_for_repo(result, repo)
	if (here.length === 0) return [VERDICT_TOKENS.wait]

	return here.map((child) => String(child.number))
}

// A listing that was cut short is reported rather than answered from silently: an opted-in issue
// past the cut is still runnable, and an epic past the cut leaves its children reading as untracked.
function warn_gaps(context: PoolContext, has_answer: boolean): void {
	const listing = auto_ok_cli.truncation_note(context.opted_in.cutoff, has_answer)
	const epics = epic_bundle_gaps.epic_gap(context.tracking.cutoff, auto_ok_cli.LISTING_LIMIT)

	if (listing !== undefined) console.error(listing)
	if (epics !== undefined) console.error(epics)
}

function report(result: EpicNextResult, context: PoolContext): number {
	warn_gaps(context, result.verdict === 'run')
	console.error(epic_report.format_result(result))

	for (const token of tokens_of(result, context.repo)) console.info(token)

	return SUCCESS_EXIT_CODE
}

// The two halves as one result. The epic half is already classified by `epic:next`; the standalone
// half is classified here; the verdict is decided from the merge, so a backlog with a runnable epic
// child and nothing else says `run` exactly as one with a runnable standalone issue does.
function combine(views: ReadonlyArray<EpicView>, context: PoolContext): EpicNextResult {
	const from_epics = backlog_pool.drop_excluded(
		backlog_pool.epic_classification(views),
		context.exclude,
		context.repo,
	)
	const from_standalone = backlog_pool.classify_standalone(
		backlog_pool.standalone_rows(context.opted_in.issues),
		{ tracked: context.tracking.tracked, exclude: context.exclude, repo: context.repo },
	)

	// The same checkout map `epic:next` hands `build_result`. Without it every bundle heading reads
	// `(no local checkout)`, including this repository's own — the misreport joshuafolkken/kit#864
	// fixed on that path.
	return epic_report.build_result(
		backlog_pool.merge_classifications(from_epics, from_standalone),
		views.flatMap((view) => view.result.anomalies),
		repo_discovery.discover_repositories(PROJECT_ROOT),
	)
}

// Nothing to classify means no epic was read, so `views_of`'s registry resets and its own checkout
// discovery are not needed. `combine` builds the map either way, so what this saves is the second
// walk rather than the only one.
function views_from(reads: ReadonlyArray<EpicRead>): ReadonlyArray<EpicView> {
	return reads.length === 0 ? [] : epic_next.views_of(reads)
}

// The reads and the classification, with none of the printing `backlog:next` then does with them.
//
// `backlog:plan` renders this same pool as a plan a person reads before the run starts
// (joshuafolkken/kit#1652), so the seam is cut here rather than a second read-and-classify path
// being written beside it: the plan and the run cannot disagree about what may start, because there
// is one answer and two renderings of it. `undefined` is the refusal — already reported.
async function resolve(context: PoolContext): Promise<EpicNextResult | undefined> {
	const references = backlog_pool
		.opted_in_epics(context.opted_in.issues)
		.map((number) => ({ number }))
	const { reads, notices, refusal } = await epic_next_read.read_snapshots(references, context.repo)

	for (const notice of notices) console.error(notice)

	if (refusal !== undefined) {
		console.error(refusal)

		return undefined
	}

	return combine(views_from(reads), context)
}

async function answer_pool(context: PoolContext): Promise<number> {
	const result = await resolve(context)

	if (result === undefined) return FAILURE_EXIT_CODE

	return report(result, context)
}

// A backlog nobody has opted into answers `none` before either listing below is asked for.
function report_none(): number {
	console.error(auto_ok_cli.NONE_OPTED_IN_MESSAGE)
	console.info(auto_ok_cli.NONE_TOKEN)

	return SUCCESS_EXIT_CODE
}

// The two reads that stand between the opted-in listing and the pool. Extracted for the same reason
// `resolve` is: `backlog:plan` needs the identical context, and a second copy of these two failure
// branches would be a second place for them to be worded differently. `undefined` is the failure —
// already reported.
async function context_of(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
): Promise<PoolContext | undefined> {
	const tracking = await auto_ok_cli.fetch_tracking(opted_in.issues.length)

	if (tracking.kind !== 'read') {
		console.error(auto_ok_cli.EPICS_UNREADABLE_MESSAGE)

		return undefined
	}

	const repo = await git_gh_command.repo_get_name_with_owner()

	if (repo === undefined) {
		console.error(REPO_UNREADABLE_MESSAGE)

		return undefined
	}

	return { opted_in, tracking, repo, exclude }
}

async function answer(opted_in: OptedIn, exclude: ReadonlyArray<number>): Promise<number> {
	if (opted_in.issues.length === 0) return report_none()

	const context = await context_of(opted_in, exclude)

	if (context === undefined) return FAILURE_EXIT_CODE

	return await answer_pool(context)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = auto_ok_cli.parse_options(argv, USAGE)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const opted_in = await auto_ok_cli.fetch_opted_in()

	if (opted_in.kind !== 'read') {
		console.error(READ_FAILURES[opted_in.kind])

		return FAILURE_EXIT_CODE
	}

	return await answer(opted_in, options.exclude ?? [])
}

// `process.exitCode` rather than `process.exit()`, for the reason `auto-ok:next` records: the whole
// contract is `answers=$(pnpm josh backlog:next)`, and exiting outright can cut the pipe before it
// has drained.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_next = {
	USAGE,
	REPO_UNREADABLE_MESSAGE,
	READ_FAILURES,
	VERDICT_TOKENS,
	tokens_of,
	warn_gaps,
	report,
	combine,
	views_from,
	resolve,
	context_of,
	answer_pool,
	report_none,
	answer,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_next }
export type { OptedIn, PoolContext }
