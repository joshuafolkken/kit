import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeApi, ThemeModule, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_isac_alert } from './run-board-theme-isac-alert'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_ending } from './run-board-theme-isac-ending'
import { run_board_theme_isac_opening } from './run-board-theme-isac-opening'
import { run_board_theme_isac_panel } from './run-board-theme-isac-panel'
import { run_board_theme_isac_pulse } from './run-board-theme-isac-pulse'

// The isac theme: a field agent's HUD in one orange on black, echoed in color and motion alone.
// Idle: the scanner's ring runs out every three seconds, contacts glow, the armor bar shimmers.
// PROGRESS: a transmission takes the panel — a waveform, brackets closing on it.
// ROW: a pulse ring sweeps the area, the hex field lighting behind it; the lane is marked.
// NOTICE: the pulses rush, hazard stripes march; at the peak every orange flips to red under a
// WARNING banner, and the red drains back left to right.

const { notice_trace, peak_flash } = run_board_theme_host_flash
const { put_level } = run_board_theme_host_grid
const { rule_glint } = run_board_theme_draw
const { alert_area, is_alert, red_flip } = run_board_theme_isac_alert
const { INKS, RGB, theme_colors, theme_notes } = run_board_theme_isac_data
const { is_receiving, panel } = run_board_theme_isac_panel
const { activation, is_activating, lane_mark } = run_board_theme_isac_pulse

// Whether an event plays: the alert up, the pulse sweeping, or the transmission in the panel.
function is_playing(state: ThemeState): boolean {
	return is_alert(state) || is_activating(state) || is_receiving(state)
}

function level_text(state: ThemeState): string {
	if (is_alert(state)) return ' STATUS ALERT'

	return state.busy ? ' STATUS ACTIVE' : ' STATUS SECURE'
}

// The alert takes the area through a notice, the pulse through a new lane; else the panel.
function hud_area(draw: ThemeDraw): void {
	if (is_alert(draw.s)) alert_area(draw)
	else if (is_activating(draw.s)) activation(draw)
	else panel(draw)
}

function hud(draw: ThemeDraw): void {
	const { api, grid, s } = draw

	notice_trace(grid, s, RGB.bright)
	rule_glint(draw, INKS.BRIGHT)
	put_level(grid, api.layout.level_spot, level_text(s), s.busy ? INKS.WHITE : INKS.ORANGE)
	hud_area(draw)
	lane_mark(draw)
	peak_flash(grid, s, INKS.FLASH)
	red_flip(draw)
}

// A field HUD prints everything in capitals.
function theme(api: ThemeApi): ThemeModule {
	return {
		name: 'ISAC',
		board: 'josh-isac',
		capitals: true,
		spinner: '·∙•●◉◎○◌◦∙',
		colons: true,
		notes: theme_notes,
		colors: theme_colors,
		opening: run_board_theme_isac_opening.opening_of(api),
		ending: run_board_theme_isac_ending.ending_of(api),
		draw: (grid, state, tick) => {
			hud({ api, grid, s: state, tick })
		},
		playing: is_playing,
	}
}

const run_board_theme_isac = { theme }

export { run_board_theme_isac }
