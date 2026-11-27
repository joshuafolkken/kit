import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeState } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_field } from './run-board-theme-isac-field'

// The isac theme's NOTICE. Over the build the pulses come faster and hazard stripes march along the
// area's top and bottom; at the peak every orange on the screen flips to red under a WARNING banner;
// over the play-out the red drains back to orange from left to right.

const { trace_on } = run_board_theme_host_flash
const { role_style } = run_board_theme_host_frame
const { ESC, restyle } = run_board_theme_host_grid
const { PEAK_TICKS, active } = run_board_theme_host_state
const { PAIR, area_pane, clear_pane, put_in, share_of } = run_board_theme_draw
const { ALERT, HEX, INKS, RED_OF, red_colors } = run_board_theme_isac_data
const { hex_field } = run_board_theme_isac_field

// A NOTICE plays: its build and its play-out, the last second left to the settled board.
function is_alert(state: ThemeState): boolean {
	return active(state.notice, ALERT.play)
}

// How many pulses have run: slowly at first, rushing into the peak, steadily after it.
function pulse_phase(state: ThemeState, tick: number): number {
	const { notice } = state
	const age = Math.min(tick - notice.start, PEAK_TICKS)
	const rush = (age / PEAK_TICKS) ** PAIR * ALERT.rush
	const after = notice.is_typing ? 0 : notice.cooled / ALERT.after

	return age / ALERT.slow + rush + after
}

// Hazard stripes along the area's top and bottom rows, marching opposite ways.
function stripes(pane: Pane, tick: number): void {
	const size = ALERT.stripes.length
	const shift = Math.floor(tick / ALERT.stripe_pace) % size
	const columns = Array.from({ length: pane.box.w }, (_, x) => x)
	const top = columns.map((x) => ALERT.stripes.charAt((x + size - shift) % size))
	const bottom = columns.map((x) => ALERT.stripes.charAt((x + shift) % size))

	put_in(pane, { x: 0, y: 0 }, top.join(''), INKS.ORANGE)
	put_in(pane, { x: 0, y: pane.box.h - 1 }, bottom.join(''), INKS.ORANGE)
}

function banner_ink(state: ThemeState): string {
	if (state.notice.is_typing) return INKS.BRIGHT

	return trace_on(state) ? INKS.WARNING : INKS.WARNING_OFF
}

// The label in the middle of the area: the anomaly through the build, the WARNING banner — a box
// three rows tall, lit with each blink of the notice — from the peak.
function banner(draw: ThemeDraw, pane: Pane): void {
	const { notice } = draw.s
	const text = notice.is_typing ? ALERT.build_label : ALERT.banner
	const x = Math.max(0, Math.floor((pane.box.w - text.length) / PAIR))
	const y = Math.floor((pane.box.h - 1) / PAIR)
	const ink = banner_ink(draw.s)
	const edges = notice.is_typing ? [] : [-1, 1]

	for (const row of edges) {
		put_in(pane, { x, y: y + row }, ' '.repeat(text.length), ink)
	}

	put_in(pane, { x, y }, text, ink)
}

// The area: the field lit whole, one ring after another running out from its middle.
function alert_area(draw: ThemeDraw): void {
	const { s, tick } = draw
	const pane = area_pane(draw)
	const center = { x: (pane.box.w - 1) / PAIR, y: (pane.box.h - 1) / PAIR }
	const reach = (pulse_phase(s, tick) % 1) * (pane.box.w / (HEX.aspect * PAIR))

	clear_pane(pane)
	hex_field(pane, { center, reach, lit: Infinity })
	stripes(pane, tick)
	banner(draw, pane)
}

// A style turned red: a role takes its red, and the theme's own oranges inside a raw style theirs.
function reddened(style: string): string {
	if (!style.startsWith(ESC)) return role_style(red_colors, style)
	let out = style

	for (const [from, to] of RED_OF) out = out.split(from).join(to)

	return out
}

// From the peak the whole screen is red right of the drain column, which crosses it left to right.
function red_flip(draw: ThemeDraw): void {
	const { api, grid, s } = draw
	const { notice } = s

	if (notice.is_typing || !is_alert(s)) return
	const drain = share_of(notice.cooled, ALERT.drain_from, ALERT.drain_ticks) * api.layout.w

	restyle(
		grid,
		(_, x) => x >= drain,
		(_x, _y, [, style]) => reddened(style),
	)
}

const run_board_theme_isac_alert = { alert_area, is_alert, pulse_phase, red_flip, reddened }

export { run_board_theme_isac_alert }
