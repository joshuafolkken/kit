import { run_board_labels } from './run-board-labels'
import type { RunActivity } from './run-board-status'

// How long the run's newest session took from its start to its first `opening lane` stage
// (`run_event_setup.first_lane_ms`, joshuafolkken/kit#5519), drawn on the header's first line once that
// stage is written — the opening began, not finished. Not `🚦`: that is a lane row's stage icon.

const ICON = '🛫'
const LEGEND = `${ICON} to first lane`

function part(activity: RunActivity): string | undefined {
	const { first_lane_ms } = activity

	return first_lane_ms === undefined
		? undefined
		: `${ICON} ${run_board_labels.span_of(first_lane_ms)}`
}

// The legend names the icon only on a frame that draws it.
function legend(activity: RunActivity): string | undefined {
	return activity.first_lane_ms === undefined ? undefined : LEGEND
}

const run_board_first_lane = { ICON, LEGEND, legend, part }

export { run_board_first_lane }
