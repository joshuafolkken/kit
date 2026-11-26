import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'
import { run_board_theme_trace } from './run-board-theme-trace'
import type { TraceView } from './run-board-theme-trace-data'

// The MATRIX port's test views (joshuafolkken/kit#8917): the demo's board read as the theme reads
// it, and a frame of a demo event drawn over a copy of the untouched board.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const BOARD = run_board_theme_trace.board_of(HOST.api)

function board_copy(): Grid {
	return HOST.api.board.map((row) => [...row])
}

// A view of `event` at `tick` over a fresh copy of the board.
function view_at(event: DemoKey, tick: number): TraceView {
	const state = state_of(HOST.layout, HOST.events[event], tick)

	return { ...BOARD, grid: board_copy(), s: state, tick }
}

// The characters of row `y` of a view's grid.
function row_text(view: TraceView, y: number): string {
	return (view.grid[y] ?? []).map(([ch]) => ch).join('')
}

function cell_of(view: TraceView, y: number, x: number): Cell {
	return run_board_theme_host_grid.cell_at(view.grid, y, x)
}

function board_cell(y: number, x: number): Cell {
	return run_board_theme_host_grid.cell_at(HOST.api.board, y, x)
}

const run_board_theme_trace_fixture = {
	BOARD,
	HOST,
	board_cell,
	board_copy,
	cell_of,
	row_text,
	view_at,
}

export { run_board_theme_trace_fixture }
