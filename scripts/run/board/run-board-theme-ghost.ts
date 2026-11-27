import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_cloak } from './run-board-theme-ghost-cloak'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_ghost_intrusion } from './run-board-theme-ghost-intrusion'
import { run_board_theme_ghost_panel } from './run-board-theme-ghost-panel'
import { run_board_theme_ghost_parts } from './run-board-theme-ghost-parts'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeApi, ThemeModule, ThemeState } from './run-board-theme-host-types'

// The ghost theme: a net dive in cyan and white with a little orange, echoed in color and motion
// alone. Nothing falls in columns: its motion is a ring of text, links, and noise resolving sideways.
// Idle: the ring of text travels round its ellipse, a net graph pulses inside it, a patch ripples.
// PROGRESS: a dive — rectangles zoom to the ring's centre, hex pairs stream sideways.
// ROW: the lane decloaks out of noise; over the data the net graph gains a node.
// NOTICE: the ring grows to take the area, blocks scramble, a bar sweeps the header; the barrier
// restores them block by block.

const { notice_trace, peak_flash } = run_board_theme_host_flash
const { put_level } = run_board_theme_host_grid
const { rule_glint } = run_board_theme_draw
const { decloak, is_linking, linking } = run_board_theme_ghost_cloak
const { INKS, RGB, theme_colors, theme_notes } = run_board_theme_ghost_data
const { intrusion, is_intruded, scrambled_share } = run_board_theme_ghost_intrusion
const { is_diving, panel } = run_board_theme_ghost_panel

// Whether an event plays: the intrusion up, the graph linking, or the panel diving.
function is_playing(state: ThemeState): boolean {
	return is_intruded(state) || is_linking(state) || is_diving(state)
}

// A breach while any block of the area is still scrambled.
function is_breached(state: ThemeState): boolean {
	return is_intruded(state) && scrambled_share(state) > 0
}

function level_text(state: ThemeState): string {
	if (is_breached(state)) return ' BARRIER BREACH'

	return state.busy ? ' LINK DIVING' : ' LINK STABLE'
}

// The intrusion takes the area through a notice; else the panel, and the graph over the data for
// a lane.
function net_area(draw: ThemeDraw): void {
	if (is_intruded(draw.s)) {
		intrusion(draw)

		return
	}

	panel(draw)
	if (is_linking(draw.s)) linking(draw)
}

function dive(draw: ThemeDraw): void {
	const { api, grid, s } = draw

	notice_trace(grid, s, RGB.orange)
	rule_glint(draw, INKS.PALE)
	put_level(grid, api.layout.level_spot, level_text(s), is_breached(s) ? INKS.ORANGE : INKS.CYAN)
	net_area(draw)
	decloak(draw)
	peak_flash(grid, s, INKS.FLASH)
}

function theme(api: ThemeApi): ThemeModule {
	return {
		name: 'GHOST',
		board: 'josh-ghost',
		spinner: '4E7A1C9F2B',
		colons: true,
		notes: theme_notes,
		colors: theme_colors,
		opening: run_board_theme_ghost_parts.opening_of(api),
		ending: run_board_theme_ghost_parts.ending_of(api),
		draw: (grid, state, tick) => {
			dive({ api, grid, s: state, tick })
		},
		playing: is_playing,
	}
}

const run_board_theme_ghost = { theme }

export { run_board_theme_ghost }
