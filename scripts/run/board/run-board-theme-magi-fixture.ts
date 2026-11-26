import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi } from './run-board-theme-magi'
import type { MagiKit } from './run-board-theme-magi-data'

// The MAGI theme's unit tests' shared pieces (joshuafolkken/kit#8917): the demo's board as a fresh
// grid, a row of it as text, the state of a demo event at a tick, and the theme's kit.

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

const KIT: MagiKit = run_board_theme_magi.kit_of(HOST.api)

const run_board_theme_magi_fixture = { HOST, KIT, fresh_grid, row_text, state_at }

export { run_board_theme_magi_fixture }
