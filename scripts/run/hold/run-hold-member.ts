import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_hold, type RunHold, type SessionOwner } from './run-hold'
import { run_hold_session } from './run-hold-session'

// Whether this session is one of a run's own (joshuafolkken/kit#4099): a lane child, or the session
// holding the run's hold on this working tree. The run's event stream is the repository's, so a
// session outside the run — a question answered beside a `backlogrun` — writes to it too, and what it
// files is not the run's.
//
// **Unknown is outside.** Unlike the `Stop` hook's question (`run-hold-session.ts`), a hold or a session
// with no owner recorded is not this session's: counting another session's filing as the run's is the
// failure this answers.

function is_owned(hold: RunHold, owner: SessionOwner): boolean {
	if (hold.owner_pid === undefined || owner.owner_pid === undefined) return false

	return run_hold_session.is_session_hold(hold, owner)
}

async function is_hold_owner(owner: SessionOwner): Promise<boolean> {
	const directory = await run_hold.worktree_directory()
	if (directory === undefined) return false

	const read = run_hold.read_hold(run_hold.hold_path(directory))

	return read.kind === 'held' && is_owned(read.hold, owner)
}

async function is_run_member(owner: SessionOwner = run_hold.session_owner()): Promise<boolean> {
	if (lane_child_marker.marked_issue() !== undefined) return true

	return await is_hold_owner(owner)
}

const run_hold_member = { is_run_member }

export { run_hold_member }
