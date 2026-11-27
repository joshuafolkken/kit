import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeState } from './run-board-theme-host-types'

// The deviant theme's unit tests' shared pieces (joshuafolkken/kit#9096): the demo's board as a fresh
// grid, a row of it as text, the state of a demo event at a tick, and a frame being drawn on it.

const { HOST } = run_board_theme_host_fixture

// The demo's untouched board, every cell its own copy.
function fresh_grid(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

// The state of the demo's event `key` (its typing starts on tick 10) at `tick`.
function state_at(key: Exclude<DemoKey, 'o' | 'x'>, tick: number): ThemeState {
	return run_board_theme_host_state.state_of(HOST.layout, HOST.events[key], tick)
}

// The demo's event `key` at `tick`, drawn onto a fresh grid.
function draw_at(key: Exclude<DemoKey, 'o' | 'x'>, tick: number): ThemeDraw {
	return { api: HOST.api, grid: fresh_grid(), s: state_at(key, tick), tick }
}

// The panel's row `y` (counted from its first) as text.
function panel_text(grid: Grid, y: number): string {
	const { area_top, px, pw } = HOST.layout

	return row_text(grid, area_top + 1 + y).slice(px, px + pw)
}

const run_board_theme_deviant_fixture = {
	HOST,
	draw_at,
	fresh_grid,
	panel_text,
	row_text,
	state_at,
}

export { run_board_theme_deviant_fixture }
