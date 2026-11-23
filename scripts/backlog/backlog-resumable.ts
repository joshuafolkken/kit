import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_orphans } from '#scripts/git/stash/stash-orphans'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_resume_wait, type ResumeWaits } from '#scripts/run/event/run-resume-wait'
import { backlog_resume_reads } from './backlog-resume-reads'

interface ResumeSignals {
	stashed: ReadonlySet<string>
	paused: ReadonlySet<string>
	open_pr: ReadonlySet<string>
	// joshuafolkken/kit#8855: stopped by an outage and not launched since (`run-resume-wait.ts`).
	outage: ReadonlySet<string>
}

type ReadSignals = Omit<ResumeSignals, 'outage'>

const NO_ISSUES: ReadonlySet<string> = new Set()

function is_resumable(issue: string, signals: ResumeSignals): boolean {
	return (
		signals.stashed.has(issue) ||
		signals.paused.has(issue) ||
		signals.open_pr.has(issue) ||
		signals.outage.has(issue)
	)
}

function enrich_children(
	children: ReadonlyArray<EpicChild>,
	repo: string,
	signals: ResumeSignals,
): Array<EpicChild> {
	return children.map((child) =>
		child.repo === repo
			? { ...child, is_resumable: is_resumable(String(child.number), signals) }
			: child,
	)
}

// Keyed by issue in scan order; a child listed twice keeps its waiting entry, which carries its blockers.
function local_children(result: EpicNextResult, repo: string): Map<string, EpicChild> {
	const children = [...result.candidates.flatMap((bundle) => bundle.children), ...result.waiting]
	const local = children.filter((child) => child.repo === repo)

	return new Map(local.map((child) => [String(child.number), child]))
}

function local_issues(result: EpicNextResult, repo: string): Array<string> {
	return [...local_children(result, repo).keys()]
}

// One read per signal for the whole scan (`backlog-resume-reads.ts`); a stashed child needs neither.
async function read_signals(result: EpicNextResult, repo: string): Promise<ReadSignals> {
	const stashed = new Set(stash_orphans.issues_of(await git_stash.list()))
	const unstashed = local_issues(result, repo).filter((issue) => !stashed.has(issue))
	if (unstashed.length === 0) return { stashed, paused: NO_ISSUES, open_pr: NO_ISSUES }
	const [paused, open_pr] = await Promise.all([
		backlog_resume_reads.paused_issues(unstashed, repo),
		backlog_resume_reads.open_pr_issues(repo),
	])

	return { stashed, paused, open_pr }
}

// Each awaiting local child's wait is recorded: a waiting child on its blockers, a candidate for a seat.
async function record_waits(
	result: EpicNextResult,
	repo: string,
	waits: ResumeWaits,
): Promise<void> {
	const awaiting = [...local_children(result, repo)].filter(([issue]) => waits.has(issue))

	await Promise.all(
		awaiting.map(async ([issue, child]) => {
			await run_resume_wait.record(waits, issue, run_resume_wait.reason_of(child))
		}),
	)
}

// Stashes are shared by this repository's lanes, never by another repository with the same issue number.
async function read(result: EpicNextResult, repo: string): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result
	const waits = run_resume_wait.awaiting(await run_event_stream_emit.current_events())
	const signals = { ...(await read_signals(result, repo)), outage: new Set(waits.keys()) }

	await record_waits(result, repo, waits)
	const candidates = result.candidates.map((bundle) => ({
		...bundle,
		children: enrich_children(bundle.children, repo, signals),
	}))

	return { ...result, candidates, waiting: enrich_children(result.waiting, repo, signals) }
}

const backlog_resumable = { read }

export { backlog_resumable }
