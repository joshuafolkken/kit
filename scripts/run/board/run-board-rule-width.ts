import { run_board_fit } from './run-board-fit'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_render_lanes } from './run-board-render-lanes'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_render_row, type RowFrame } from './run-board-render-row'
import { run_board_render_title } from './run-board-render-title'

// The column every rule runs on to (joshuafolkken/kit#5520): where a running lane row's head ends when
// its title fills the title column, kept within the pane. It measures that row rather than the drawn ones,
// so the rules keep one width with no lane row, with any number of them and whatever their titles
// (joshuafolkken/kit#8247). A pane narrower than that row's head runs every rule to its edge
// (joshuafolkken/kit#8663).

const { TITLE_LIMIT } = run_board_render_title
const { head_text } = run_board_render_row
// The digit count a board with no lane row measures by, as the board's issue numbers are.
const PROBE_DIGITS = 4

// The probe's number has as many digits as the widest drawn lane number (PROBE_DIGITS with none), all
// nines so it never shares a real lane's number and picks up that lane's operation tail.
function probe_number(layout: BoardLayout | undefined): number {
	const lanes = layout === undefined ? [] : run_board_layout.lanes_drawn(layout)
	const digits = Math.max(
		...lanes.map((row) => String(row.number).length),
		lanes.length === 0 ? PROBE_DIGITS : 0,
	)

	return Number('9'.repeat(digits))
}

function probe_of(layout: BoardLayout | undefined): BoardRow {
	return {
		number: probe_number(layout),
		title: 'x'.repeat(TITLE_LIMIT),
		kind: undefined,
		state: 'running',
		status: undefined,
		waits: [],
	}
}

function rule_width(frame: RowFrame): number {
	const probe = probe_of(frame.header.layout)
	const indent = run_board_render_lead.indent_of(probe)
	const lane_frame = {
		...frame,
		cells: run_board_render_lanes.lane_cells_of(frame.header, [probe]),
		is_lane_row: true,
	}
	const head = head_text(probe, { ...lane_frame, title_limit: TITLE_LIMIT })
	const end = run_board_fit.width_of(`${indent}${head}`)

	return Math.min(end, frame.columns ?? Infinity)
}

const run_board_rule_width = { rule_width }

export { run_board_rule_width }
