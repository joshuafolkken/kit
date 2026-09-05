import {
	time_github,
	type CheckRun,
	type CheckRunList,
	type CommitList,
	type GhReader,
	type PullSummary,
} from './time-github'
import { time_overlap, type Interval } from './time-overlap'
import type { Span } from './time-spans'

// What a run actually waited for CI, and where that wait fell (joshuafolkken/kit#1384).
//
// **A pull request runs CI once per commit, and only the last cycle can be the one the merge waited
// on.** Measured on PR #1380: cycle one ran 01:49:19 → 01:51:09 beside the second review round and
// cost the run nothing, while cycle two ran 01:53:38 → 01:55:27 with the run doing nothing but
// waiting, and the merge followed at 01:56:01. `josh time` read the head commit's check-runs alone,
// so a second cycle could not be expressed at all — and it read a negative `merge_gap` as "the run
// did not wait", which is never true of `followup --merge`, whose whole job is to wait for the
// checks before merging. The `ci` phase therefore reported 0, and `diag` ranked the issue that would
// have cut those 109 seconds last, as work with no wall clock behind it.
//
// **Two figures come out of this, and they answer different questions.** `ci_ms` is the category
// share — the part of the open→merge window *no* span covers, which is what a run left unattended
// spends — and it is unchanged. The windows are what the phase table charges to `ci`: the part of a
// CI cycle that only the merge command was sitting on. Neither is derived from the other, and the
// phase reattribution is the arithmetic in `time-phases.ts` rather than a second definition here.
//
// **The reads are bounded and the head one is reused.** A commit listing is one request, the head
// commit's check-runs were already read for the per-check table, and everything else is one request
// per further commit up to the cap below.

const NO_DURATION = 0

// How many commits one report reads check-runs for. A `fullrun` pushes one commit, or two where the
// second review round fixed something in place, so the cap is never reached in practice — it is here
// because a pull request with fifty commits would otherwise spend fifty requests per measured run,
// and `--epic` measures a whole batch of them. **Passing it is reported as unmeasured rather than
// silently truncated**: a subset of the cycles is not the wait, and a figure built from one is worse
// than no figure.
//
// **It is also what makes the single-page commit listing safe.** `list_pull_commits` reads one page
// and cannot tell a full page from a truncated one — but a truncated page carries `PAGE_SIZE` rows,
// which is past this cap, so such a listing is reported unmeasured rather than read as complete. The
// guarantee is `MAX_COMMITS < PAGE_SIZE`, asserted in this module's suite rather than left implied.
const MAX_COMMITS = 10

// The CI half of a run, in the states a read of it has.
interface CiFacts {
	// The part of the pull request's open→merge window that no transcript span covers — the fourth
	// category share, and the figure `time-report.ts` prints as `CI wait`.
	ci_ms: number
	// Whether the GitHub half was read at all. A session report has no pull request, so a `0.0 min`
	// row there would assert a measurement nobody made.
	has_ci_data: boolean
	// One window per commit that ran checks — its first `started_at` to its last `completed_at` —
	// clamped to the open→merge window so nothing outside the measured run can be charged to it.
	windows: ReadonlyArray<Interval>
	// Whether those windows are the whole set. `false` is "could not measure", which the phase table
	// reports as `not detected` rather than as zero minutes of CI.
	has_windows: boolean
}

// What a scope with no pull request passes: a session report, and a run whose measurement failed
// outright. Every field is the withheld answer rather than a measured zero.
const NO_CI: CiFacts = {
	ci_ms: NO_DURATION,
	has_ci_data: false,
	windows: [],
	has_windows: false,
}

// Everything the read needs. A record rather than five positional parameters, which the four-parameter
// limit forbids anyway.
interface CiInput {
	pull: PullSummary
	merged_ms: number
	spans: ReadonlyArray<Span>
	// The head commit's check-runs, already read by the caller for the per-check table. Passed in so
	// the same request is not made twice — and so the two readings cannot disagree about what the head
	// commit ran.
	head: CheckRunList
	read: GhReader
}

// One commit's CI cycle: the first job to start, the last to finish. **The jobs overlap each other**,
// so the window is their span rather than their sum — a cycle of six parallel jobs is as long as its
// slowest, not six times as long.
//
// Clamped to the open→merge window, which is what keeps the phase reattribution from double counting:
// everything outside that window is either before the run's pull request existed or after it merged,
// and the category share is measured over exactly the same interval.
function cycle_window(runs: ReadonlyArray<CheckRun>, bounds: Interval): Interval | undefined {
	if (runs.length === 0) return undefined

	const started_ms = Math.max(Math.min(...runs.map((run) => run.started_ms)), bounds.started_ms)
	const ended_ms = Math.min(Math.max(...runs.map((run) => run.completed_ms)), bounds.ended_ms)

	return ended_ms <= started_ms ? undefined : { started_ms, ended_ms }
}

// The head commit's list is the one the caller already holds; every other commit costs a request.
async function checks_of(sha: string, input: CiInput): Promise<CheckRunList> {
	if (sha === input.pull.head_sha) return input.head

	return await time_github.list_check_runs(sha, input.read)
}

interface CycleRead {
	windows: Array<Interval>
	is_failed: boolean
}

// A commit that ran no check has no cycle at all, so it contributes no window rather than an empty
// one. Kept apart from the walk above so that walk answers one question — did every read answer? —
// and this one answers the other.
function windows_of(lists: ReadonlyArray<CheckRunList>, bounds: Interval): Array<Interval> {
	return lists
		.map((list) => cycle_window(list.runs, bounds))
		.filter((window): window is Interval => window !== undefined)
}

// A listing this measurement will not read: past the cap, refused, or abandoned partway.
// **Nothing further is fetched for it.**
const UNREAD_CYCLES: CycleRead = { windows: [], is_failed: true }

// **A commit with no readable check-runs yields no window, and a refused read yields a flag.** Those
// are two different answers: a commit that ran nothing really has no cycle, while a rate-limited read
// says nothing at all about what ran.
//
// **The commits are read one at a time, not fanned out.** This runs *inside* `time-batch.ts`'s pool,
// which already holds eight run reports open at once and bounds them for the reason its comment
// gives — an unbounded fan-out turns a rate limit into a wrong answer. A `Promise.all` here would
// multiply that eight by the commit count, and a throttled read does not fail loudly: it clears
// `has_windows`, and every affected child's `ci` phase silently becomes `not detected`.
//
// **The first refusal ends the walk.** One unread commit already fixes the answer at "could not
// measure", so every further request buys nothing — and the request that fails is usually a rate
// limit, which the remaining nine would deepen for the siblings still to be measured.
async function read_cycles(
	shas: ReadonlyArray<string>,
	input: CiInput,
	bounds: Interval,
): Promise<CycleRead> {
	const lists: Array<CheckRunList> = []

	for (const sha of shas) {
		const list = await checks_of(sha, input)

		if (list.is_failed) return UNREAD_CYCLES

		lists.push(list)
	}

	return { windows: windows_of(lists, bounds), is_failed: false }
}

// **The cap is applied before the reads, not after them.** Slicing the listing and deciding
// afterwards spent ten requests on a pull request whose answer was already going to be "could not
// measure" — which is the cost the cap exists to avoid, paid in full.
function is_readable(commits: CommitList): boolean {
	return !commits.is_failed && commits.shas.length <= MAX_COMMITS
}

// One merged pull request's CI facts. Never throws: a refused listing, a refused check read and a
// pull request with more commits than the cap each come back as `has_windows: false`, which the
// report prints in words.
async function build_facts(input: CiInput): Promise<CiFacts> {
	const bounds: Interval = { started_ms: input.pull.created_ms, ended_ms: input.merged_ms }
	const covered = input.spans.map((span) => time_overlap.to_interval(span))
	const commits = await time_github.list_pull_commits(input.pull.number, input.read)
	const cycles = is_readable(commits)
		? await read_cycles(commits.shas, input, bounds)
		: UNREAD_CYCLES

	return {
		ci_ms: time_overlap.uncovered_ms(bounds, covered),
		has_ci_data: true,
		windows: cycles.windows,
		has_windows: !cycles.is_failed,
	}
}

const time_ci = {
	MAX_COMMITS,
	NO_CI,
	cycle_window,
	build_facts,
}

export type { CiFacts, CiInput }
export { time_ci }
