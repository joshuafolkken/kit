import { run_board_earlier } from './run-board-earlier'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// The icon a `run:board` row leads with: its state's, or its phase's while it runs. A held lane keeps
// it, 🚧 standing in the progress column before it (joshuafolkken/kit#4292).

const { PHASE_ICONS, STATE_ICONS } = run_board_labels
const { EARLIER_ICON } = run_board_earlier

// A row that says what it waits on leads with that wait's icon in place of its state's
// (joshuafolkken/kit#4288).
function state_lead(row: BoardRow): string {
	return row.reason?.icon ?? STATE_ICONS[row.state]
}

// A running row leads with the icon of the phase it is in now — the last its track reached — and
// with 🔄 while it has reached none yet; an earlier run's running lane leads with 🧳 in its place.
function running_lead(row: BoardRow): string {
	const current = row.status?.track?.at(-1)

	return current === undefined ? state_lead(row) : PHASE_ICONS[current]
}

function state_icon(row: BoardRow): string {
	if (row.state !== 'running') return state_lead(row)

	return row.is_earlier === true ? EARLIER_ICON : running_lead(row)
}

const run_board_render_icon = {
	state_icon,
}

export { run_board_render_icon }
