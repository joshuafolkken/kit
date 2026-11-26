import {
	run_board_theme_flux_context,
	type FluxContext,
	type Moment,
} from './run-board-theme-flux-context'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'

// The BTTF theme's unit tests' board (joshuafolkken/kit#8917): the confirmed demo's board, layout and
// events, the theme's context for it, and the state and moment of an event at a tick.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state

const CONTEXT: FluxContext = run_board_theme_flux_context.context_of(HOST.api)

// A fresh copy of the demo's untouched board, to draw on.
function board_grid(): Grid {
	return HOST.board.map((row) => [...row])
}

function state_at(event: DemoKey, tick: number): ThemeState {
	return state_of(HOST.layout, HOST.events[event], tick)
}

function moment_at(event: DemoKey, tick: number): Moment {
	const state = state_at(event, tick)

	return { state, motion: run_board_theme_flux_motion.motion_of(state), tick }
}

// The characters of row `y` of `grid`.
function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

const run_board_theme_flux_fixture = { CONTEXT, HOST, board_grid, moment_at, row_text, state_at }

export { run_board_theme_flux_fixture }
