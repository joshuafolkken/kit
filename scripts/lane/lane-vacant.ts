import { git_command } from '#scripts/git/git-command'
import { run_hold } from '#scripts/run/hold/run-hold'
import { PROCESS_NONE } from '#scripts/run/run-liveness'
import { lane_await } from './lane-await'
import type { LaneInfo } from './lane-registry'

// Whether an open lane holds nothing worth keeping: no commit on its branch
// beyond the default branch, a clean work tree, and no child or ship supervisor alive for its issue. A
// `backlogrun` cut between `lane:open` and `lane:dispatch` leaves exactly such a lane, and `lane:open`
// refuses it as `already-open` — so the next launch of that issue failed on a lane with nothing in it.
//
// **Every unreadable answer is "not vacant"**: `is_tree_dirty` already reads an unreadable status as
// dirty, a process probe that could not look reads as occupied, and a branch whose commits cannot be counted is kept rather than closed, because closing it
// deletes the branch and anything on it.
async function has_no_commits(lane: LaneInfo): Promise<boolean> {
	try {
		const base = await git_command.default_branch_reference()

		return (await git_command.commit_count_beyond(base, lane.branch)) === 0
	} catch {
		return false
	}
}

// Only pgrep's own "no match" clears a lane: a probe that failed or timed out never looked, and a
// freshly launched child with no commit yet must not read vacant on it (joshuafolkken/kit#4028).
function is_occupied(lane: LaneInfo): boolean {
	return lane.is_stranded || lane_await.process_trace_default(lane.issue) !== PROCESS_NONE
}

async function is_vacant(lane: LaneInfo): Promise<boolean> {
	if (is_occupied(lane) || (await run_hold.is_tree_dirty(lane.directory))) return false

	return await has_no_commits(lane)
}

// The issues of the lanes that hold nothing worth keeping, read in parallel.
async function vacant_issues(lanes: ReadonlyArray<LaneInfo>): Promise<Array<string>> {
	const answers = await Promise.all(lanes.map(async (lane) => await is_vacant(lane)))

	return lanes.filter((_lane, index) => answers[index] === true).map((lane) => lane.issue)
}

const lane_vacant = { is_vacant, vacant_issues }

export { lane_vacant }
