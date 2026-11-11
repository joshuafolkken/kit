import { auto_ok_author } from '#scripts/auto-ok/auto-ok-author'
import { auto_ok_cli, type OptedInRead } from '#scripts/auto-ok/auto-ok-cli'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { epic_busy } from '#scripts/epic/epic-busy'
import type { Classification } from '#scripts/epic/epic-classify'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_index } from '#scripts/epic/epic-index'
import { epic_next } from '#scripts/epic/epic-next'
import type { EpicRead } from '#scripts/epic/epic-next-read'
import type { EpicView } from '#scripts/epic/epic-next-views'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import { epic_solo_stale } from '#scripts/epic/epic-solo-stale'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { issue_not_before_label } from '#scripts/issue/issue-not-before-label'
import { lane_net_read } from '#scripts/lane/lane-net-read'
import { backlog_auto_triage } from './backlog-auto-triage'
import { backlog_defect_priority } from './backlog-defect-priority'
import { backlog_gate_scope, type OptedIn, type PoolContext } from './backlog-gate-scope'
import { backlog_next_report } from './backlog-next-report'
import { backlog_pool } from './backlog-pool'
import { backlog_rank } from './backlog-rank'
import { backlog_resumable } from './backlog-resumable'

// `josh backlog:next` — what the whole opted-in backlog may run next.
//
// Neither half alone can give the answer. `epic:next` has the dependency graph and the execution
// wave, but its input is **one epic's task list**. `auto-ok:next` sees the whole backlog, but it
// orders by the display's ranking, oldest first on ties, and reads no dependency at all.
//
// This command is the route that asks the backlog itself what may start, and it is glue rather than a third implementation: the epic half runs
// through `epic:next`'s own read → classify → report pipeline unchanged, the standalone half through
// `auto-ok:next`'s own listing and runnability rules, and the verdict comes from
// `epic_report.decide_verdict` so it cannot drift from what `epic:next` means by the same word.

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

// The settled set the views were classified against, so a standalone row and an epic child weigh the
// same blocker the same way.
function running_of(
	views: ReadonlyArray<EpicView>,
	graphs: ReadonlyArray<ReadonlyArray<EpicChild>>,
	context: PoolContext,
): ReadonlySet<string> {
	return (
		views[0]?.running ??
		backlog_pool.running_set(graphs, context.opted_in.issues, context, context.tracking.index)
	)
}

// The two halves as one result. The epic half is already classified by `epic:next`; the standalone
// half is classified here; the verdict is decided from the merge, so a backlog with a runnable epic
// child and nothing else says `run` exactly as one with a runnable standalone issue does.
// `untrusted` is the epic children an author without write access filed (joshuafolkken/kit#4633).
function epic_half(
	views: ReadonlyArray<EpicView>,
	context: PoolContext,
	untrusted: ReadonlySet<string>,
): Classification {
	return backlog_pool.drop_excluded(
		backlog_pool.epic_classification(views, untrusted),
		context.exclude,
		context.repo,
	)
}

function combine(
	views: ReadonlyArray<EpicView>,
	context: PoolContext,
	untrusted: ReadonlySet<string>,
): EpicNextResult {
	const graphs = views.map((view) => view.snapshot.children)
	const standalone = backlog_pool.standalone_rows(context.opted_in.issues)
	const from_epics = epic_half(views, context, untrusted)
	const from_standalone = backlog_pool.classify_standalone(standalone, {
		...context,
		tracked: epic_index.withheld_children(context.tracking.index, context.opted_in.issues),
		running: running_of(views, graphs, context),
	})

	// The same checkout map `epic:next` hands `build_result`. Without it every bundle heading reads
	// `(no local checkout)`, including this repository's own.
	return epic_report.build_result(
		backlog_pool.merge_classifications(from_epics, from_standalone),
		[
			...views.flatMap((view) => view.result.anomalies),
			...backlog_pool.cross_epic_cycles(graphs, backlog_pool.to_children(standalone, context.repo)),
		],
		repo_discovery.discover_repositories(PROJECT_ROOT),
	)
}

// The epic half and the standalone half settled against each other: an epic child a person has to
// resolve can make a standalone row wait on that person, and that row can in turn hold an epic child.
// Each pass only shrinks the set, so the walk ends at the first pass that removes nothing.
function settled_views(
	reads: ReadonlyArray<EpicRead>,
	running: ReadonlySet<string>,
	context: PoolContext,
): ReadonlyArray<EpicView> {
	const views = epic_next.views_of(reads, running)
	const settled = backlog_pool.settle_standalone(
		views[0]?.running ?? running,
		context.opted_in.issues,
		context,
		context.tracking.index,
	)

	return settled.size === running.size ? views : settled_views(reads, settled, context)
}

// Nothing to classify means no epic was read, so `views_of`'s registry resets and its own checkout
// discovery are not needed. `combine` builds the map either way, so what this saves is the second
// walk rather than the only one.
//
// The running set covers the standalone rows as well as every read graph, so an epic child waiting on
// an opted-in standalone issue waits rather than stops.
function views_from(
	reads: ReadonlyArray<EpicRead>,
	context: PoolContext,
	untrusted: ReadonlySet<string>,
): ReadonlyArray<EpicView> {
	if (reads.length === 0) return []

	const graphs = backlog_pool.trusted_graphs(
		reads.map((read) => read.snapshot.children),
		untrusted,
	)

	return settled_views(
		reads,
		backlog_pool.running_set(graphs, context.opted_in.issues, context, context.tracking.index),
		context,
	)
}

// The reads and the classification, with none of the printing `backlog:next` then does with them.
//
// `backlog:plan` renders this same pool as a plan a person reads before the run starts,
// so the seam is cut here rather than a second read-and-classify path
// being written beside it: the plan and the run cannot disagree about what may start, because there
// is one answer and two renderings of it. `undefined` is the refusal — already reported.
async function resolve(context: PoolContext): Promise<EpicNextResult | undefined> {
	const { reads, notices, refusal } = await backlog_pool.read_epics(context)

	for (const notice of notices) console.error(notice)

	if (refusal !== undefined) {
		console.error(refusal)

		return undefined
	}

	const children = reads.flatMap((read) => read.snapshot.children)
	const untrusted = await auto_ok_author.untrusted_child_keys(children, context.repo)
	// The defect priority and the ranking keys are applied here rather than when printing, so
	// `backlog:plan` shows the order the run takes. The
	// ranking goes last: its sort is stable, so the defect order survives as its final key.
	const ordered = await backlog_defect_priority.prioritize(
		combine(views_from(reads, context, untrusted), context, untrusted),
		context.repo,
	)

	return backlog_rank.rank_result(await backlog_resumable.read(ordered, context.repo), context.repo)
}

// Whether the `error` verdict is really a transport failure wearing the graph's clothes.
//
// **The answer comes from the reads that failed, not from a request made afterwards**. A later
// reachability probe can answer `reachable` after a connection that dropped for a few hundred
// milliseconds already failed the read, leaving the verdict `error` for a fault that had already
// healed. Judging one request from a different one cannot be made reliable, so the failed
// request carries its own nature instead: `epic:next` marks the anomaly from the status GitHub wrote
// on the failed response, and this reads the mark.
function is_transport_failure(result: EpicNextResult): boolean {
	if (result.verdict !== 'error') return false

	return result.anomalies.some((anomaly) => anomaly.is_unreachable === true)
}

// The `run:solo` gate is applied here rather than in `resolve`, because `backlog:plan` shares
// `resolve` and a plan made before the run lists everything. The holders are
// read only on a `run` answer — the one answer the gate can change. The cap follows the gate
// (`backlog-rank.ts`).
async function gate_solo(result: EpicNextResult, context: PoolContext): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result

	const { repo } = context
	const { read, notice } = await epic_solo_stale.release(
		await epic_busy.read_repository(repo),
		repo,
	)

	if (notice !== undefined) console.error(notice)

	const scope = await backlog_gate_scope.gate_scope(context, read)
	const gated = backlog_rank.gate(result, read, repo, scope)

	if (gated.notice !== undefined) console.error(gated.notice)

	return gated.result
}

// The untriaged candidates are held out before the `run:solo` gate, which cannot read a label not
// recorded yet (`backlog_next_report.report_held`).
async function answer_held(
	result: EpicNextResult,
	context: PoolContext,
	untriaged: ReadonlyArray<EpicChild>,
): Promise<number> {
	const gated = await gate_solo(
		backlog_next_report.without_untriaged(result, context.repo),
		context,
	)

	return await backlog_next_report.report_held(gated, context, untriaged)
}

async function answer_pool(context: PoolContext): Promise<number> {
	const resolved = await resolve(context)

	if (resolved === undefined) return FAILURE_EXIT_CODE
	if (is_transport_failure(resolved)) return backlog_next_report.report_retry(context)

	const { result, untriaged } = await backlog_auto_triage.untriaged_of(resolved, context.repo)

	if (untriaged.length > 0) return await answer_held(result, context, untriaged)

	return await backlog_next_report.report(await gate_solo(result, context), context)
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

	return { opted_in, tracking, repo, exclude, ...(await lane_net_read.measurements()) }
}

async function answer(opted_in: OptedIn, exclude: ReadonlyArray<number>): Promise<number> {
	// The scan has every opted-in body and its labels already, so it keeps `not-before` in line with them
	// and with every other issue the label is on — before any answer, so a drained backlog or a failed
	// read still takes a passed label off.
	await issue_not_before_label.sweep(opted_in.issues)

	if (opted_in.issues.length === 0) return backlog_next_report.report_none()

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

const backlog_next = {
	USAGE,
	REPO_UNREADABLE_MESSAGE,
	RETRY_MESSAGE: backlog_next_report.RETRY_MESSAGE,
	READ_FAILURES,
	VERDICT_TOKENS: backlog_next_report.VERDICT_TOKENS,
	resolve,
	context_of,
	run,
}

export { backlog_next }
export type { BacklogVerdict } from './backlog-next-report'
