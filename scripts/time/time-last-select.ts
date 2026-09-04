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
	end: WalkEnd
}

// The merge instants are carried rather than a running count, because whether a skipped row competed
// is decided against the *final* Nth merge — which is not known until the walk ends.
interface RunPick {
	runs: Array<MergedRun>
	skipped_ms: Array<number>
}

const NO_PICK: RunPick = { runs: [], skipped_ms: [] }

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
function page_runs(pulls: ReadonlyArray<PullSummary>): RunPick {
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
// oldest run kept. With nothing kept there is no cutoff and every one of them counts, which is the
// only reading available when the walk resolved no run at all.
function skipped_within(stamps: ReadonlyArray<number>, cutoff_ms: number | undefined): number {
	if (cutoff_ms === undefined) return stamps.length

	return stamps.filter((merged_ms) => merged_ms >= cutoff_ms).length
}

// **One row per issue, the newest merge winning.** A reverted change and its revert are two merged
// pull requests on branches naming the same issue, and both halves of that issue's measurement are
// the same — so keeping both would put one run into the distribution twice and report five readings
// where four were taken.
function newest_per_issue(runs: ReadonlyArray<MergedRun>): Array<MergedRun> {
	const seen = new Set<number>()
	const kept: Array<MergedRun> = []

	for (const run of runs) {
		if (!seen.has(run.issue_number)) kept.push(run)

		seen.add(run.issue_number)
	}

	return kept
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
		const runs = newest_per_issue(newest_first([...best.runs, ...page.runs])).slice(0, count)

		return {
			best: { runs, skipped_ms: [...best.skipped_ms, ...page.skipped_ms] },
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
	const { runs, skipped_ms } = walk.best

	return {
		runs,
		skipped_count: skipped_within(skipped_ms, runs.at(-1)?.merged_ms),
		end: walk.end,
	}
}

const time_last_select = {
	page_runs,
	newest_per_issue,
	skipped_within,
	pick_folder,
	select_last_runs,
}

export type { MergedRun, RunPick, RunSelection }
export { time_last_select }
