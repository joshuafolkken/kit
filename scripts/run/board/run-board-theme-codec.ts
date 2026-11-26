import { run_board_theme_codec_alert, type Phase } from './run-board-theme-codec-alert'
import {
	run_board_theme_codec_context,
	type Codec,
	type Paint,
} from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_ending } from './run-board-theme-codec-ending'
import { run_board_theme_codec_field } from './run-board-theme-codec-field'
import { run_board_theme_codec_opening } from './run-board-theme-codec-opening'
import { run_board_theme_codec_panel } from './run-board-theme-codec-panel'
import { run_board_theme_codec_talk } from './run-board-theme-codec-talk'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeApi, ThemeModule, ThemeState } from './run-board-theme-host-types'

// The METAL GEAR theme (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-demo.mjs`, theme 4, `metal_gear`).
// Idle: status block, codec on standby and the radar in the panel.
// PROGRESS: a codec call inside the panel — a bust portrait either end, the frequency and voice
// bars between them; THROUGHPUT and USAGE stay.
// ROW: the radar takes the area and a new contact pings on it; "?" beside the lane.
// NOTICE: ALERT — the jammed radar and the countdown take the area, the header shouts, the screen
// flashes; then EVASION in the area, then CAUTION back in the panel.

const { BOLD, bg, fg } = run_board_theme_host_grid
const { active, LINGER } = run_board_theme_host_state
const { notice_trace, peak_flash, start_flash } = run_board_theme_host_flash
const { COLORS, NOTES, SPINNER } = run_board_theme_codec_data
const { alert_header, alert_pulse, alert_screen, alert_wave, phase_of } =
	run_board_theme_codec_alert
const { codec_screen } = run_board_theme_codec_talk
const { contact_screen } = run_board_theme_codec_field
const { idle_panel, idle_sweep, mark } = run_board_theme_codec_panel
const { ending_of } = run_board_theme_codec_ending
const { opening_of } = run_board_theme_codec_opening

const ROW_TAIL = 20
const PROGRESS_TAIL = 12
const TRACE_COLOR = '255;230;60'
const FLASH = { white: '255;255;255', red: '200;20;20' }
const START_FLASH = `${fg(FLASH.white)}${BOLD}${bg(FLASH.red)}`
const PEAK_FLASH = `${fg(FLASH.red)}${BOLD}${bg(FLASH.white)}`

// ALERT and EVASION take the area; CAUTION is back in the panel.
function is_alert_screen(now: Phase | undefined): now is Phase {
	return now !== undefined && now.label !== 'CAUTION'
}

// The contact screen is up while a lane types and a second after; the codec's while the now line does.
function is_contact(state: ThemeState): boolean {
	return active(state.row, ROW_TAIL + LINGER)
}

function is_talking(state: ThemeState): boolean {
	return active(state.progress, PROGRESS_TAIL + LINGER)
}

function metal_gear_area(codec: Codec, paint: Paint, now: Phase | undefined): void {
	const { s } = paint

	if (is_alert_screen(now)) alert_screen(codec, paint, now)
	else if (is_contact(s)) contact_screen(codec, paint)
	else if (is_talking(s)) codec_screen(codec, paint)
	else idle_panel(codec, paint, now)
}

// Whether an event plays: an alert phase, CAUTION too, or either screen up.
function is_playing(state: ThemeState): boolean {
	return phase_of(state, state.tick) !== undefined || is_contact(state) || is_talking(state)
}

// The alert overflows: every section below the area pulses red and the header shouts.
function alert_overflow(codec: Codec, paint: Paint, now: Phase | undefined): void {
	if (now?.label !== 'ALERT') return
	alert_pulse(codec, paint)
	alert_header(codec, paint.grid, paint.tick)
}

// The whole screen flashes as a notice starts and peaks; "!" and "?" blink beside their rows.
function flashes(codec: Codec, paint: Paint): void {
	const { grid, s, tick } = paint

	start_flash(grid, s, tick, START_FLASH)
	peak_flash(grid, s, PEAK_FLASH)
	mark(grid, s.notice, tick, codec.alert_mark)
	mark(grid, s.row, tick, codec.query_mark)
}

function metal_gear(codec: Codec, paint: Paint): void {
	const { grid, s, tick } = paint
	const now = phase_of(s, tick)

	notice_trace(grid, s, TRACE_COLOR)
	if (now) alert_wave(codec.layout, grid, now, tick)
	metal_gear_area(codec, paint, now)
	idle_sweep(codec, paint)
	alert_overflow(codec, paint, now)
	flashes(codec, paint)
}

// The codec's subtitles and the game's own text are written in mixed case; only its HUD labels
// (ALERT, LIFE, PTT) are capitals, and those are this theme's own drawings.
function theme(api: ThemeApi): ThemeModule {
	const codec = run_board_theme_codec_context.codec_of(api)

	return {
		name: 'METAL GEAR',
		board: 'josh-codec',
		capitals: false,
		spinner: SPINNER,
		notes: NOTES,
		colors: COLORS,
		opening: opening_of(codec),
		ending: ending_of(codec),
		draw: (grid, state, tick) => {
			metal_gear(codec, { grid, s: state, tick })
		},
		playing: is_playing,
	}
}

const run_board_theme_codec = { theme }

export { run_board_theme_codec }
