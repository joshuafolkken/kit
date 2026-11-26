import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import type { SkynetDraw } from './run-board-theme-skynet-data'

// The TERMINATOR theme's test fixture (joshuafolkken/kit#8917): a frame being drawn on the demo's
// board at a tick of one of its events, and a grid row as text.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state

// A fresh grid of the demo's untouched board, its cells copied so a test may draw on it.
function fresh_grid(): Grid {
	return HOST.api.board.map((row) => row.map(([ch, style]): [string, string] => [ch, style]))
}

// The demo's `event` at `tick`, drawn onto a fresh grid.
function draw_at(event: DemoKey, tick: number): SkynetDraw {
	const state = state_of(HOST.layout, HOST.events[event], tick)

	return { api: HOST.api, grid: fresh_grid(), s: state, tick }
}

function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

const run_board_theme_skynet_fixture = { HOST, draw_at, fresh_grid, row_text }

export { run_board_theme_skynet_fixture }
