import { run_board_theme_flux_clocks } from './run-board-theme-flux-clocks'
import {
	run_board_theme_flux_context,
	type FluxContext,
	type Moment,
} from './run-board-theme-flux-context'
import { run_board_theme_flux_data } from './run-board-theme-flux-data'
import { run_board_theme_flux_display } from './run-board-theme-flux-display'
import { run_board_theme_flux_figure } from './run-board-theme-flux-figure'
import { run_board_theme_flux_idle } from './run-board-theme-flux-idle'
import { run_board_theme_flux_jump } from './run-board-theme-flux-jump'
import { run_board_theme_flux_lines } from './run-board-theme-flux-lines'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'
import { run_board_theme_flux_parts } from './run-board-theme-flux-parts'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import type { Grid, ThemeApi, ThemeModule, ThemeState } from './run-board-theme-host-types'

// The BTTF theme of `run:board` (joshuafolkken/kit#8917), the Back to the Future time circuits,
// ported from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.
// Idle: the flux capacitor and the lamp gauge at the panel's right end, the three time circuits left
// of them, the speed readout on the THROUGHPUT rule.
// PROGRESS: the line types in the body grey; the speed climbs a little and falls back.
// ROW: the new lane arrives cold — the row strip flashes, sparks crackle ahead of the cursor, the
// typed letters thaw from ice white, a short fire trail burns off its tail; the figure pulses faster.
// NOTICE: the JUMP — the speed climbs to 88, the figure quickens, bolts crawl over the screen, the
// time circuits and the speed take the area in large digits; at the peak the screen washes blue-white
// to white, fire trails burn along the two gaps, the clocks roll and the board thaws back from ice.

const { draw_circuits, header_clocks } = run_board_theme_flux_clocks
const { context_of } = run_board_theme_flux_context
const { COLORS, NOTES, SPEED_COLOR, text_of } = run_board_theme_flux_data
const { big_display } = run_board_theme_flux_display
const { draw_figure, draw_speed, is_event } = run_board_theme_flux_figure
const { idle_touches, under_event_touches } = run_board_theme_flux_idle
const { draw_jump } = run_board_theme_flux_jump
const { arrive_line, draw_progress, draw_row } = run_board_theme_flux_lines
const { motion_of } = run_board_theme_flux_motion
const { ending_of, opening_of } = run_board_theme_flux_parts
const { notice_trace } = run_board_theme_host_flash

// The panel: the clocks, the circuits, the figure and the speed, then the touches under the event.
function draw_panel(context: FluxContext, grid: Grid, moment: Moment): void {
	header_clocks(context, grid, moment)
	draw_circuits(context, grid, moment)
	draw_figure(context, grid, moment.motion, moment.tick)
	draw_speed(context, grid, moment)
	under_event_touches(context, grid, moment)
}

function draw(context: FluxContext, grid: Grid, state: ThemeState, tick: number): void {
	const moment = { state, motion: motion_of(state), tick }

	notice_trace(grid, state, text_of(SPEED_COLOR))
	draw_panel(context, grid, moment)
	draw_progress(context, grid, state, tick)
	draw_row(context, grid, state, tick)
	// The notice types in with the theme's typewriter, louder than the progress line's.
	if (state.notice_text.is_typing) arrive_line(grid, context.lines.notice, state.notice_text, tick)
	big_display(context, grid, moment)
	draw_jump(context, grid, moment)
	idle_touches(context, grid, moment)
}

// The theme for the board `api` describes; the board's name comes from the host's table (josh-flux).
// The demo host blinks every theme's header colons, so the theme asks for them.
function theme(api: ThemeApi): ThemeModule {
	const context = context_of(api)

	return {
		name: 'BTTF',
		colons: true,
		opening: opening_of(context),
		ending: ending_of(context),
		notes: NOTES,
		colors: COLORS,
		draw: (grid, state, tick) => {
			draw(context, grid, state, tick)
		},
		playing: is_event,
	}
}

const run_board_theme_flux = { theme }

export { run_board_theme_flux }
