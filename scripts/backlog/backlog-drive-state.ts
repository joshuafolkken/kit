import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_await } from '#scripts/lane/lane-await'
import type { DriveState } from './backlog-drive'

// joshuafolkken/kit#8855: a seeded child whose process is gone is reported finished only after the
// re-confirm window, so the first offer waits until then and a dead child is collected — and ranked as
// an outage — before a fresh issue takes its seat. Twice the window covers the poll lag between the start
// and the first idle read. A window restart re-seeds, so each invocation pays this once.
const SETTLING_FACTOR = 2

function settling_until(in_flight: ReadonlyArray<string>, active: string): number | undefined {
	if (in_flight.length === 0) return undefined

	return Date.parse(active) + SETTLING_FACTOR * lane_await.RECONFIRM_MS
}

function initial_state(in_flight: ReadonlyArray<string>, active: string): DriveState {
	return {
		in_flight: [...in_flight],
		exclude: [],
		active,
		retries: 0,
		is_stopping: false,
		settling_until_ms: settling_until(in_flight, active),
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
