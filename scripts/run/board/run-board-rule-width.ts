import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render_lanes } from './run-board-render-lanes'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_render_row, type RowFrame } from './run-board-render-row'
import { run_board_render_title } from './run-board-render-title'

// The column every rule runs on to (joshuafolkken/kit#5520): where a running lane row whose title fills
// the title column ends in this pane, kept within it. It measures that row rather than the drawn ones,
// so the rules keep one width with no lane row, with any number of them and whatever their titles
// (joshuafolkken/kit#8247).

const { TITLE_LIMIT, fitted_limit } = run_board_render_title
const { head_text, row_draw, row_fit } = run_board_render_row
// A four-digit number, as the board's issue numbers are.
const PROBE_NUMBER = 9999

const PROBE: BoardRow = {
	number: PROBE_NUMBER,
	title: 'x'.repeat(TITLE_LIMIT),
	kind: undefined,
	state: 'running',
	status: undefined,
	waits: [],
}

function rule_width(frame: RowFrame): number {
	const indent = run_board_render_lead.indent_of(PROBE)
	const cells = run_board_render_lanes.lane_cells_of(frame.header, [PROBE])
	const lane_frame = { ...frame, cells, is_lane_row: true }
	const fit = row_fit(indent, PROBE, lane_frame)
	const draw = row_draw(indent, PROBE, lane_frame, fit)
	const title_limit = fitted_limit(PROBE, frame.columns, draw, fit) ?? TITLE_LIMIT
	const end = run_board_fit.width_of(`${indent}${head_text(PROBE, { ...lane_frame, title_limit })}`)

	return Math.min(end, frame.columns ?? Infinity)
}

const run_board_rule_width = { rule_width }

export { run_board_rule_width }
