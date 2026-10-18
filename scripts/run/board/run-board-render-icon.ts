import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_waits } from './run-board-render-waits'

// The icon a `run:board` row leads with: its state's, its phase's while it runs, or 🚧 while its lane
// is held.

const { NOT_BEFORE_ICON, PHASE_ICONS, STATE_ICONS } = run_board_labels

// A row waiting on the start time its body declares leads with 📅 in place of its state's icon.
function state_lead(row: BoardRow): string {
	return row.reason?.not_before_ms === undefined ? STATE_ICONS[row.state] : NOT_BEFORE_ICON
}

// A running row leads with the icon of the phase it is in now — the last its track reached — and
// with 🔄 while it has reached none yet.
function phase_lead(row: BoardRow): string {
	const current = row.state === 'running' ? row.status?.track?.at(-1) : undefined

	return current === undefined ? state_lead(row) : PHASE_ICONS[current]
}

// 🚧 while the row's lane is held (joshuafolkken/kit#4052), its end keeping the phase's icon.
function state_icon(row: BoardRow, header: BoardHeader): string {
	const { BUDGET_ICON, held_of } = run_board_render_waits

	return held_of(row, header) === undefined ? phase_lead(row) : BUDGET_ICON
}

const run_board_render_icon = {
	state_icon,
}

export { run_board_render_icon }
