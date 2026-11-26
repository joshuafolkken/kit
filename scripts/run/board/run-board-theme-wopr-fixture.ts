import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_place, type Wopr } from './run-board-theme-wopr-place'

// The WARGAMES theme's tests' board (joshuafolkken/kit#8917): its tables for the demo's layout, a
// fresh copy of the demo's board to draw on, and the demo's events' state at a tick.

const { HOST } = run_board_theme_host_fixture

const WOPR: Wopr = run_board_theme_wopr_place.wopr_of(HOST.api)

function board_grid(): Grid {
	return HOST.board.map((row) => row.map(([ch, style]) => [ch, style]))
}

function state_at(event: DemoKey, tick: number): ThemeState {
	return run_board_theme_host_state.state_of(HOST.layout, HOST.events[event], tick)
}

function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

// The cell at `at`, a blank where the grid has none.
function cell_of(grid: Grid, at: Point): Cell {
	return grid[at.y]?.[at.x] ?? [' ', '']
}

const run_board_theme_wopr_fixture = { HOST, WOPR, board_grid, cell_of, row_text, state_at }

export { run_board_theme_wopr_fixture }
