import { run_board_theme_codec_call } from './run-board-theme-codec-call'
import { run_board_theme_codec_context, type Codec } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// The codec on its own (joshuafolkken/kit#8917), ported from the confirmed theme demo's METAL GEAR
// opening and ending: centred on the screen, opening from a line and closing to one.

const { BOLD, bg, fg, framed, put } = run_board_theme_host_grid
const { GREEN, STYLE } = run_board_theme_codec_data
const { CODEC } = run_board_theme_codec_context
const { codec_display } = run_board_theme_codec_call

// The styles the opening and the ending share: the board dimmed, the bright line, the tube's glow.
const MG_DIM = STYLE.bar_off
const MG_LINE = `${fg(GREEN.bright)}${BOLD}`
const MG_GLOW = `${fg(GREEN.glow)}${bg(GREEN.ok)}`
const WINDOW_EDGE = `${fg('200;255;215')}${BOLD}`
const DISPLAY_X = 12
const HALF = 2
const BLANK: Grid[number][number] = [' ', 'body']

// What the codec unit shows: its label lit or not, the level and the frequency.
interface UnitLook {
	label: string
	is_lit: boolean
	level: number
	freq: string
}

// The codec on its own, centred on the screen: its frame, CALL or PTT over the stepped level meter
// with the frequency in its curve, MEMORY under it, an arrow either side — codec_screen's display.
function codec_unit(codec: Codec, grid: Grid, look: UnitLook): void {
	const { x, y } = codec.codec_at
	const lit = `${look.is_lit ? STYLE.codec_lit : STYLE.green_dim}${STYLE.dark_box}`
	const { label, level, freq } = look

	framed(grid, { x, y, w: CODEC.w, h: CODEC.h }, 'CODEC', STYLE.frame)
	codec_display(
		grid,
		{ y: y + 1, x: x + DISPLAY_X },
		{ label, label_style: lit, arrow_style: lit, level, freq },
	)
}

// A row beyond the window: the codec's columns show `under` again.
function window_row(grid: Grid, under: Grid, y: number, x0: number): void {
	const row = grid[y]
	const from = under[y]

	if (!row || !from) return
	for (let x = x0; x < x0 + CODEC.w; x++) row[x] = from[x] ?? BLANK
}

// The window's edge, a bright line, while the window is not fully open.
function window_edge(grid: Grid, y: number, x: number, half: number): void {
	if (half < CODEC.h / HALF) put(grid, { y, x }, '━'.repeat(CODEC.w), WINDOW_EDGE)
}

// The codec shown only `half` rows either side of its middle row, as it opens from a line or closes
// to one: the rows beyond show `under`, and the window's edge is a bright line.
function codec_window(codec: Codec, grid: Grid, under: Grid, half: number): void {
	const { x, y: top } = codec.codec_at
	const mid = top + Math.floor(CODEC.h / HALF)

	for (let y = top; y < top + CODEC.h; y++) {
		const off = Math.abs(y - mid)

		if (off > half) window_row(grid, under, y, x)
		else if (off === half) window_edge(grid, y, x, half)
	}
}

// The screen's own edge, framed.
function screen_frame(codec: Codec, grid: Grid, style: string): void {
	const { w, h } = codec.layout

	run_board_theme_host_grid.rect_frame(grid, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, style)
}

const run_board_theme_codec_unit = {
	BLANK,
	MG_DIM,
	MG_GLOW,
	MG_LINE,
	codec_unit,
	codec_window,
	screen_frame,
}

export { run_board_theme_codec_unit }
export type { UnitLook }
