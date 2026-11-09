import { issue_cite } from '#scripts/issue/issue-cite'
import type { DriveState } from './backlog-drive'

function initial_state(in_flight: ReadonlyArray<string>, active: string): DriveState {
	return {
		in_flight: [...in_flight],
		exclude: [],
		active,
		retries: 0,
		is_stopping: false,
	}
}

// Preserve the first stop when an offer already stopped the run.
function merge_stopped(issue: string, state: DriveState): DriveState {
	if (state.is_stopping) return state

	return {
		...state,
		is_stopping: true,
		stop_reason: `run:merge ${issue_cite.plain_for('terminal', issue)} answered stop`,
		stopped_by: issue,
	}
}

const backlog_drive_state = { initial_state, merge_stopped }

export { backlog_drive_state }
