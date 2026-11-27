import { run_board_theme_demo_fixture, type PlayedKey } from './run-board-theme-demo-fixture'
import type { ThemeDraw } from './run-board-theme-draw'
import type { Grid } from './run-board-theme-host-types'

// The deviant theme's unit tests' shared pieces (joshuafolkken/kit#9096): the demo's board pieces of
// `run-board-theme-demo-fixture.ts`, a frame being drawn on it, and a panel row as text.

const { HOST, fresh_grid, row_text, state_at } = run_board_theme_demo_fixture

// The demo's event `key` at `tick`, drawn onto a fresh grid.
function draw_at(key: PlayedKey, tick: number): ThemeDraw {
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
