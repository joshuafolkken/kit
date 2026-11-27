import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeState } from './run-board-theme-host-types'

// The theme unit tests' shared pieces on the demo's board (joshuafolkken/kit#9096): the board as a
// fresh grid, a row of it as text, and the state of a demo event at a tick.

const { HOST } = run_board_theme_host_fixture

type PlayedKey = Exclude<DemoKey, 'o' | 'x'>

// The demo's untouched board, every cell its own copy.
function fresh_grid(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

// The state of the demo's event `key` (its typing starts on tick 10) at `tick`.
function state_at(key: PlayedKey, tick: number): ThemeState {
	return run_board_theme_host_state.state_of(HOST.layout, HOST.events[key], tick)
}

const run_board_theme_demo_fixture = { HOST, fresh_grid, row_text, state_at }

export { run_board_theme_demo_fixture }
export type { PlayedKey }
