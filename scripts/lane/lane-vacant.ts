import { git_command } from '#scripts/git/git-command'
import { run_hold } from '#scripts/run/hold/run-hold'
import { lane_await } from './lane-await'
import type { LaneInfo } from './lane-registry'

// Whether an open lane holds nothing worth keeping: no commit on its branch
// beyond the default branch, a clean work tree, and no child or ship supervisor alive for its issue. A
// `backlogrun` cut between `lane:open` and `lane:dispatch` leaves exactly such a lane, and `lane:open`
// refuses it as `already-open` — so the next launch of that issue failed on a lane with nothing in it.
//
// **Every unreadable answer is "not vacant"**: `is_tree_dirty` already reads an unreadable status as
// dirty, and a branch whose commits cannot be counted is kept rather than closed, because closing it
// deletes the branch and anything on it.
async function has_no_commits(lane: LaneInfo): Promise<boolean> {
	try {
		const base = await git_command.default_branch_reference()

		return (await git_command.commit_count_beyond(base, lane.branch)) === 0
	} catch {
		return false
	}
}

function is_occupied(lane: LaneInfo): boolean {
	return lane.is_stranded || lane_await.is_process_running_default(lane.issue)
}

async function is_vacant(lane: LaneInfo): Promise<boolean> {
	if (is_occupied(lane) || (await run_hold.is_tree_dirty(lane.directory))) return false

	return await has_no_commits(lane)
}

const lane_vacant = { is_vacant }

export { lane_vacant }
