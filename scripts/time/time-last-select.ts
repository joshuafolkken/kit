import { cost_attribute } from '#scripts/cost/cost-attribute'
import {
	time_github,
	type GhReader,
	type PullFold,
	type PullFolder,
	type PullSummary,
	type WalkEnd,
} from './time-github'

// Which runs "the last N" are (joshuafolkken/kit#1312).
//
// **This is the only thing `--last` does that `--epic` does not.** An epic reads its children off a
// task list; here the runs are chosen from the pull-request listing itself, and from that point on
// both scopes go through the same fan-out in `time-batch.ts`. So the selection is a file of its own
// and the measurement is not duplicated at all.
//
// **It is the no-argument default extended from one run to N.** `pnpm josh time` with no flag already
// reports "the most recently merged run", resolved by exactly this rule — the newest merge, and the
// issue its head branch names. Nothing new decides what a run is.

const NONE = 0

// One selected run: the pull request, and the issue the two halves of its measurement are joined on.
//
// **`merged_ms` is carried rather than read back off the pull request.** A `PullSummary`'s is
// `number | undefined` because an open pull request has none, and every row here merged — so keeping
// it typed is what stops the sort falling back on a `?? 0` that would order an unmerged row first.
interface MergedRun {
	issue_number: number
	merged_ms: number
	pull: PullSummary
}

// What the walk produced. `end` is carried out rather than turned into a message here: how the walk
// ended is what says whether "only three runs" means the repository has three or means the read
// stopped early, and only the caller writes sentences.
interface RunSelection {
	runs: Array<MergedRun>
	// Merged pull requests whose head branch names no issue **and which merged no earlier than the
	// oldest run kept**. Counted rather than dropped silently: a run is measured by issue number, so
	// one with no such branch has nothing to join its transcript half to — which is a reason, and a
	// reason is worth a sentence.
	//
	// **The cutoff is what makes the sentence true.** A page holds a hundred rows and the walk may read
	// five of them, so counting every branchless merge it passed would report "40 merged pull requests
	// were left out" for a `--last 3` where at most two could ever have competed — a number that reads
	// as candidates dropped from the answer when they were never candidates at all.
	skipped_count: number
	// Merged pull requests that named the same issue as a run already kept, newest number first
	// (joshuafolkken/kit#1365). The fold below is the one exclusion `--last` used to make in silence:
	// a skipped row is counted, a run short of a measurement carries its own reason, and a duplicate
	// merge left no trace anywhere — so a set called "the last 5" could be built from six merges with
	// nothing saying so.
	//
	// **Numbers rather than a count, because the row it was folded into is labelled by issue.** A bare
	// count leaves a reader unable to find either end of the pair; the pull request number is the one
	// handle that reaches both.
	collapsed_pulls: Array<number>
	end: WalkEnd
}

// One page's merged rows, before anything is folded. **There is no `collapsed` half here**: which
// merge wins an issue is decided against every page read so far, so a page on its own has nothing to
// report — which is why the fold below is a wider type rather than this one.
interface PageRuns {
	runs: Array<MergedRun>
	skipped_ms: Array<number>
}

// The merge instants are carried rather than a running count, because whether a skipped row competed
// is decided against the *final* Nth merge — which is not known until the walk ends. `collapsed` is
// carried whole for the same reason: whether a fold reaches the answer depends on whether the run it
// folded into survives the walk.
interface RunPick extends PageRuns {
	collapsed: Array<MergedRun>
}

// The two halves of one issue's rows: the merge that wins, and the ones it absorbed.
interface IssueFold {
	kept: Array<MergedRun>
	collapsed: Array<MergedRun>
}

const NO_PICK: RunPick = { runs: [], skipped_ms: [], collapsed: [] }

// Which issue a head branch names is `cost_attribute.issue_from_branch`'s rule and never a second
// one — the same reading `time-pull-index.ts` resolves an epic's children by, and the same one the
// transcript side attributes spans by.
function to_run(pull: PullSummary): MergedRun | undefined {
	const { merged_ms } = pull

	if (merged_ms === undefined) return undefined

	const issue_number = cost_attribute.issue_from_branch(pull.branch)

	if (issue_number === cost_attribute.UNATTRIBUTED_KEY) return undefined

	return { issue_number, merged_ms, pull }
}

function is_merged(pull: PullSummary): boolean {
	return pull.merged_ms !== undefined
}

// The merged rows of one page, split into the ones that name an issue and the merge instants of the
// ones that do not. Both halves come from one pass so neither can drift from the other.
function page_runs(pulls: ReadonlyArray<PullSummary>): PageRuns {
	const merged = pulls.filter((pull) => is_merged(pull))
	const runs = merged
		.map((pull) => to_run(pull))
		.filter((run): run is MergedRun => run !== undefined)
	const named = new Set(runs.map((run) => run.pull.number))

	return {
		runs,
		skipped_ms: merged
			.filter((pull) => !named.has(pull.number))
			.map((pull) => pull.merged_ms ?? NONE),
	}
}

// How many of the branchless merges could have been in the answer: those merged no earlier than the
// oldest run kept. With no cutoff every one of them counts.
function skipped_within(stamps: ReadonlyArray<number>, cutoff_ms: number | undefined): number {
	if (cutoff_ms === undefined) return stamps.length

	return stamps.filter((merged_ms) => merged_ms >= cutoff_ms).length
}

// **There is a cutoff only where the request was filled.** With fewer runs than asked for there were
// unfilled slots, so every branchless merge the walk passed really was a candidate for one of them —
// and the oldest run kept is not a boundary any of them failed to clear. Nothing kept at all is the
// same case, which is why one test covers both.
function cutoff_of(runs: ReadonlyArray<MergedRun>, count: number): number | undefined {
	if (runs.length < count) return undefined

	return runs.at(-1)?.merged_ms
}

// **One row per issue, the newest merge winning.** A reverted change and its revert are two merged
// pull requests on branches naming the same issue, and both halves of that issue's measurement are
// the same — so keeping both would put one run into the distribution twice and report five readings
// where four were taken.
//
// **The loser is handed back rather than dropped** (joshuafolkken/kit#1365). Collapsing is right; the
// silence was not, and the caller cannot say what it did not receive.
function newest_per_issue(runs: ReadonlyArray<MergedRun>): IssueFold {
	const seen = new Set<number>()
	const kept: Array<MergedRun> = []
	const collapsed: Array<MergedRun> = []

	for (const run of runs) {
		const fold = seen.has(run.issue_number) ? collapsed : kept

		fold.push(run)
		seen.add(run.issue_number)
	}

	return { kept, collapsed }
}

// Which of the folds reached the answer. **A duplicate whose own run was pushed out of the window was
// never a candidate**, and naming it would point at a run the table does not show — the same cutoff
// `skipped_within` applies to a branchless merge, asked here as issue membership rather than as a
// merge instant, because a fold is tied to the run it folded into rather than to a boundary.
//
// **A row is never reported as folded into itself.** A listing paginated by update time can hand the
// same pull request back on a later page if something touched it mid-walk, and the second copy folds
// into the first — so without the second filter the command would name a pull request that is sitting
// in the table as its own duplicate, which is a false reading of the one fact this exists to state.
// The number set is what catches it; issue membership cannot, because the two copies share an issue.
//
// Deduplicated for the same reason, and sorted so the same set of runs always reports the same
// sentence.
function collapsed_within(
	collapsed: ReadonlyArray<MergedRun>,
	runs: ReadonlyArray<MergedRun>,
): Array<number> {
	const issues = new Set(runs.map((run) => run.issue_number))
	const shown = new Set(runs.map((run) => run.pull.number))
	const numbers = collapsed
		.filter((run) => issues.has(run.issue_number) && !shown.has(run.pull.number))
		.map((run) => run.pull.number)

	return [...new Set(numbers)].toSorted((left, right) => right - left)
}

function newest_first(runs: ReadonlyArray<MergedRun>): Array<MergedRun> {
	return runs.toSorted((left, right) => right.merged_ms - left.merged_ms)
}

// **The walk may stop once N are held and this page's oldest update is no newer than the Nth merge.**
// That is `time-github.ts`'s own proof applied to the last of the runs kept rather than to the first:
// every row after this page was last touched before that merge, so none of them can displace it. The
// helper is shared rather than restated, so the two scopes cannot come to disagree about when a
// listing has been read far enough.
function is_settled(
	pulls: ReadonlyArray<PullSummary>,
	runs: ReadonlyArray<MergedRun>,
	count: number,
): boolean {
	if (runs.length < count) return false

	return time_github.is_past_merge_boundary(pulls, runs.at(-1)?.merged_ms)
}

// This page folded into what the pages before it offered. The candidate is the whole pick rather than
// one pull request, which is what `PullFold`'s type parameter exists for — an epic's per-issue index
// is carried across pages the same way.
function pick_folder(count: number): PullFolder<RunPick> {
	return (pulls: ReadonlyArray<PullSummary>, best: RunPick): PullFold<RunPick> => {
		const page = page_runs(pulls)
		const fold = newest_per_issue(newest_first([...best.runs, ...page.runs]))
		const runs = fold.kept.slice(0, count)

		return {
			best: {
				runs,
				skipped_ms: [...best.skipped_ms, ...page.skipped_ms],
				collapsed: [...best.collapsed, ...fold.collapsed],
			},
			is_certain: is_settled(pulls, runs, count),
		}
	}
}

// The `count` most recently merged runs, newest merge first. **A short answer is still an answer**:
// a repository with three merged runs, a walk that hit the page cap and one that could not read the
// listing at all each hand back what they have, and `end` is what tells the caller which of the three
// it was.
async function select_last_runs(
	count: number,
	read: GhReader = time_github.read_gh,
): Promise<RunSelection> {
	const walk = await time_github.walk_pulls(pick_folder(count), read, { ...NO_PICK })
	const { runs, skipped_ms, collapsed } = walk.best

	return {
		runs,
		skipped_count: skipped_within(skipped_ms, cutoff_of(runs, count)),
		collapsed_pulls: collapsed_within(collapsed, runs),
		end: walk.end,
	}
}

const time_last_select = {
	page_runs,
	newest_per_issue,
	skipped_within,
	collapsed_within,
	cutoff_of,
	pick_folder,
	select_last_runs,
}

export type { IssueFold, MergedRun, PageRuns, RunPick, RunSelection }
export { time_last_select }
