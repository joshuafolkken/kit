import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeApi, ThemeModule } from './run-board-theme-host-types'
import { run_board_theme_skynet_acquire } from './run-board-theme-skynet-acquire'
import { run_board_theme_skynet_data, type SkynetDraw } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_hud } from './run-board-theme-skynet-hud'
import { run_board_theme_skynet_threat } from './run-board-theme-skynet-threat'
import { run_board_theme_skynet_vision } from './run-board-theme-skynet-vision'

// The TERMINATOR theme (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-demo.mjs`, theme key 6).
// Idle: the HUD rescans, a reticle hops lane to lane, the listing ticks, a scan band rolls down.
// PROGRESS: reticle and beam on the line; the panel's HUD and listing race.
// ROW: target acquisition takes the area — the lane's number framed, three listings racing.
// NOTICE: the screen flashes, a crosshair spans the whole screen and closes on the notice, the red
// vision pulses, the area fills with listings, the header carries the HUD; then POSSIBLE RESPONSE.

const { notice_trace, peak_flash, start_flash } = run_board_theme_host_flash
const { put_level } = run_board_theme_host_grid
const { LINGER, NOTICE_END, TRACE_ON, active } = run_board_theme_host_state
const { acquisition } = run_board_theme_skynet_acquire
const { INKS, WHITE_RGB, theme_colors, theme_notes } = run_board_theme_skynet_data
const { idle_reticle, panel_hud, panel_listing, reticle_lane, target } = run_board_theme_skynet_hud
const { threat_header, threat_screen } = run_board_theme_skynet_threat
const { crosshair, vignette } = run_board_theme_skynet_vision

// ROW's screen holds 24 ticks after the lane types.
const ROW_TAIL = 24

// Neither screen up: the threat level, the panel's listing and its HUD.
function panel_area(draw: SkynetDraw, lane: string): void {
	const { api, grid, s } = draw
	// This theme's own level, where the wargames frame had its DEFCON scale.
	const text = s.busy ? ' THREAT: LOW' : ' THREAT: NONE'

	put_level(grid, api.layout.level_spot, text, s.busy ? INKS.INK : INKS.PINK)
	panel_listing(draw)
	panel_hud(draw, lane)
}

function terminator_area(draw: SkynetDraw, lane: string): void {
	const { s } = draw

	if (active(s.notice, NOTICE_END)) {
		threat_screen(draw)

		return
	}

	if (active(s.row, ROW_TAIL + LINGER)) {
		acquisition(draw)

		return
	}

	panel_area(draw, lane)
}

function terminator(draw: SkynetDraw): void {
	const { api, grid, s, tick } = draw

	notice_trace(grid, s, WHITE_RGB)
	idle_reticle(draw)
	terminator_area(draw, reticle_lane(api, tick))
	if (active(s.notice, TRACE_ON)) threat_header(draw)

	for (const typed of s.all) target(draw, typed)

	crosshair(draw)
	start_flash(grid, s, tick, INKS.FLASH)
	peak_flash(grid, s, INKS.FLASH)
}

// The machine's vision prints everything in capitals; the picture tube switches it on and off.
function theme(api: ThemeApi): ThemeModule {
	return {
		name: 'TERMINATOR',
		board: 'josh-skynet',
		capitals: true,
		spinner: '▖▘▝▗',
		notes: theme_notes,
		colors: theme_colors,
		background: (x, y, tick, state) => vignette(api.layout, { y, x }, tick, state),
		opening: api.tube_on,
		ending: api.tube_off,
		draw: (grid, state, tick) => {
			terminator({ api, grid, s: state, tick })
		},
	}
}

const run_board_theme_skynet = { theme }

export { run_board_theme_skynet }
