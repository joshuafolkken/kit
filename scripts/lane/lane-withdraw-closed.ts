import { git_command } from '#scripts/git/git-command'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_board_closed, type ClosedIssue } from '#scripts/run/board/run-board-closed'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_withdraw, type Withdrawer } from './lane-withdraw'

// Every open lane whose issue was closed on GitHub as not planned is withdrawn through `lane:withdraw`'s
// own path (joshuafolkken/kit#4915): its child is stopped, its work stashed and the lane closed, so the
// lane leaves the count and no cut resumes it. Nothing else ends such a lane: the child keeps working on
// an issue no one wants, and the lane limit counts it while the board draws no lane for it.
//
// **Only a not-planned close is swept.** A merged issue's lane is ended by the merge path, where a
// detached ship may still be running its tail; an issue closed as completed by hand is left to
// `lane:prune` and `run:merge`, which books it withdrawn when no merged pull request closed it
// (joshuafolkken/kit#4916). An issue that could not be read is
// asked again on the next pass, and a lane whose withdrawal is already on the event stream is not
// withdrawn twice.
//
// **A branch with commits on no remote is kept**: the close deletes the branch and the stash keeps only
// uncommitted work, so a person decides with `lane:withdraw` by hand. `run:merge` withdraws through the
// same guard (`withdraw_lane`).

const SWEEP_REASON = 'its issue was closed as not planned while the lane was still open'

function is_not_planned(read: ClosedIssue | undefined): boolean {
	return read !== undefined && read.is_not_planned && !read.is_merged
}

/** The open lanes whose issue is closed as not planned. */
async function closed_lanes(): Promise<Array<LaneInfo>> {
	const listed = await lane_registry.list_lanes()
	const lanes = listed.filter((lane) => !lane.is_stranded)
	const { closed } = await run_board_closed.read_all(lanes.map((lane) => Number(lane.issue)))

	return lanes.filter((lane) => is_not_planned(closed.get(Number(lane.issue))))
}

// An unreadable count keeps the branch, as unpushed commits would.
async function has_unpushed(branch: string): Promise<boolean> {
	try {
		return (await git_command.commit_count_unpushed(branch)) > 0
	} catch (error) {
		error_text.trace_swallowed('lane_withdraw_closed.has_unpushed', error)

		return true
	}
}

function kept_note(issue: string, by: Withdrawer): string {
	const settled = by === 'yield' ? 'gave its lane back' : 'is closed without a merge'

	return `${session_cite.issue(issue)} ${settled}, but its branch has commits on no remote, so its lane is kept — run \`pnpm josh lane:withdraw ${issue}\` by hand.`
}

interface UnattendedWithdrawal {
	note: string
	// The withdrawal could not read the issue, so nothing was stopped or closed.
	is_retry: boolean
}

/** Withdraw a closed issue's open lane with no person present, keeping a branch with unpushed commits. */
async function withdraw_lane(
	lane: LaneInfo,
	reason: string,
	by: Withdrawer,
): Promise<UnattendedWithdrawal> {
	if (await has_unpushed(lane.branch)) return { note: kept_note(lane.issue, by), is_retry: false }
	const outcome = await lane_withdraw.withdraw(lane.issue, reason, by)

	return {
		note: lane_withdraw.describe(outcome, lane.issue),
		is_retry: outcome.kind === 'unreadable',
	}
}

async function sweep_lane(
	lane: LaneInfo,
	events: ReadonlyArray<RunEvent>,
): Promise<string | undefined> {
	if (run_event_scope.is_withdrawn(events, lane.issue)) return undefined
	const { note } = await withdraw_lane(lane, SWEEP_REASON, 'supervisor')

	return note
}

// One lane's failure does not stop the sweep: the rest are still withdrawn, and this one is asked again.
async function try_sweep_lane(
	lane: LaneInfo,
	events: ReadonlyArray<RunEvent>,
): Promise<string | undefined> {
	try {
		return await sweep_lane(lane, events)
	} catch (error) {
		error_text.trace_swallowed('lane_withdraw_closed.sweep_lane', error)

		return `${session_cite.issue(lane.issue)} could not be withdrawn (${error_text.message_of(error)}); the next pass tries again.`
	}
}

/** Withdraw every open lane whose issue is closed as not planned — the supervisor's pass; one note each. */
async function withdraw_closed(): Promise<Array<string>> {
	const lanes = await closed_lanes()
	const events = await run_event_stream_emit.current_events()
	const notes: Array<string> = []

	// Sequential, as `lane_close.close_each` is: two worktree removals at once contend for git's
	// registration directory.
	for (const lane of lanes) {
		// eslint-disable-next-line no-await-in-loop -- worktree writes contend for the same registration directory
		const note = await try_sweep_lane(lane, events)

		if (note !== undefined) notes.push(note)
	}

	return notes
}

const lane_withdraw_closed = { SWEEP_REASON, withdraw_closed, withdraw_lane }

export { lane_withdraw_closed }
