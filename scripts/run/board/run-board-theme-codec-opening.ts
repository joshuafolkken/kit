import { run_board_theme_codec_call } from './run-board-theme-codec-call'
import { run_board_theme_codec_context, type Codec } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_unit, type UnitLook } from './run-board-theme-codec-unit'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import type { Corners, Grid, ThemePart } from './run-board-theme-host-types'

// The codec theme's opening (joshuafolkken/kit#8917), ported from the confirmed theme demo: a codec
// call comes in on an empty screen — CALL blinks, the frequency dials in and locks on 140.85, the
// stepped meter rises; PTT is pressed (a green flash) and the voice jumps; the codec's frame opens
// from the centre out to the screen's edges with the board dim behind it; the codec closes to a
// line; then a radar sweep runs in from the radar's side and leaves the board at full brightness
// behind it, and the frame goes out.

const { BOLD, bg, dimmed, fg, rect_frame, restyle } = run_board_theme_host_grid
const { eased } = run_board_theme_host_parts
const { CODEC } = run_board_theme_codec_context
const { GREEN, freq_at } = run_board_theme_codec_data
const { codec_freq, talking_level } = run_board_theme_codec_call
const { BLANK, MG_DIM, MG_LINE, codec_unit, codec_window, screen_frame } =
	run_board_theme_codec_unit

const MG_OPEN = { ptt: 40, open: 52, close: 72, sweep: 80, fade: 108, ticks: 120 }
const CALL = { blink: 8, lit: 4, rise: 3, full: 10, dial_from: 6 }
const SWEEP = { tail: 2, w: 3 }
const WINDOW_HALF = 5
const FLASH_GAP = 2
const PTT_FLASH = `${fg('20;40;25')}${BOLD}${bg(GREEN.bright)}`

// The frame's corners, eased out from the codec's to the screen's.
function frame_corners(codec: Codec, tick: number): Corners {
	const { w, h } = codec.layout
	const { x, y } = codec.codec_at
	const share = eased((tick - MG_OPEN.open + 1) / (MG_OPEN.close - MG_OPEN.open))

	return {
		x0: Math.round(x * (1 - share)),
		x1: Math.round(x + CODEC.w - 1 + share * (w - x - CODEC.w)),
		y0: Math.round(y * (1 - share)),
		y1: Math.round(y + CODEC.h - 1 + share * (h - y - CODEC.h)),
	}
}

function outside_row(row: Grid[number], x0: number, x1: number): void {
	for (let x = 0; x < row.length; x++) if (x < x0 || x > x1) row[x] = BLANK
}

// The frame opens on the board, dim inside it and blank outside.
function mg_frame_open(codec: Codec, grid: Grid, tick: number): void {
	const corners = frame_corners(codec, tick)

	dimmed(grid, MG_DIM)

	for (let y = 0; y < codec.layout.h; y++) {
		const row = grid[y]

		if (!row || y < corners.y0 || y > corners.y1) codec.api.blank_row(grid, y)
		else outside_row(row, corners.x0, corners.x1)
	}

	rect_frame(grid, corners, MG_LINE)
}

// The radar's sweep, from the board's right edge (the radar's side) to the left: the board is dim
// left of the line and itself behind it, where it has passed.
function mg_sweep(codec: Codec, grid: Grid, tick: number): void {
	const { edge } = codec.layout
	const speed = Math.ceil((edge + SWEEP.w) / (MG_OPEN.fade - MG_OPEN.sweep - SWEEP.tail))
	const sx = edge - (tick - MG_OPEN.sweep) * speed

	restyle(
		grid,
		([ch], x) => ch !== ' ' && x < sx,
		() => MG_DIM,
	)
	restyle(
		grid,
		([ch], x) => ch !== ' ' && x >= sx && x < sx + SWEEP.w,
		(x) => `${fg(x === sx ? GREEN.glow : '170;240;185')}${BOLD}`,
	)
	for (const row of grid) if (row[sx]?.[0] === ' ') row[sx] = ['│', MG_LINE]
	screen_frame(codec, grid, MG_LINE)
}

function mg_backdrop(codec: Codec, grid: Grid, tick: number): void {
	if (tick < MG_OPEN.open) codec.api.blank_screen(grid)
	else if (tick < MG_OPEN.sweep) mg_frame_open(codec, grid, tick)
	else if (tick < MG_OPEN.fade) mg_sweep(codec, grid, tick)
	else screen_frame(codec, grid, MG_DIM)
}

function mg_call_look(tick: number): UnitLook {
	if (tick >= MG_OPEN.ptt) {
		return { label: 'PTT', is_lit: true, level: talking_level(tick), freq: freq_at(0) }
	}

	return {
		label: 'CALL',
		is_lit: tick % CALL.blink < CALL.lit,
		level: Math.min(CALL.full, Math.floor(tick / CALL.rise)),
		freq: codec_freq({ index: 0, start: CALL.dial_from }, tick),
	}
}

// The codec closes to a line before the sweep.
function call_closing(codec: Codec, grid: Grid, under: Grid, tick: number): void {
	if (tick < MG_OPEN.close) return
	const closed = (tick - MG_OPEN.close + 1) / (MG_OPEN.sweep - MG_OPEN.close)

	codec_window(codec, grid, under, Math.round(WINDOW_HALF * (1 - closed)))
}

// PTT pressed: the whole screen flashes green twice.
function ptt_flash(grid: Grid, tick: number): void {
	if (tick !== MG_OPEN.ptt && tick !== MG_OPEN.ptt + FLASH_GAP) return
	restyle(
		grid,
		() => true,
		() => PTT_FLASH,
	)
}

function opening_draw(codec: Codec, grid: Grid, tick: number): void {
	if (tick >= MG_OPEN.fade + SWEEP.tail) return
	mg_backdrop(codec, grid, tick)
	if (tick >= MG_OPEN.sweep) return
	const under = grid.map((row) => [...row])

	codec_unit(codec, grid, mg_call_look(tick))
	call_closing(codec, grid, under, tick)
	ptt_flash(grid, tick)
}

function opening_of(codec: Codec): ThemePart {
	return {
		ticks: MG_OPEN.ticks,
		note: 'a codec call: CALL blinks, 140.85 dials in, PTT — the frame opens on the board, the codec closes, a radar sweep brings the board up',
		draw: (grid, tick) => {
			opening_draw(codec, grid, tick)
		},
	}
}

const run_board_theme_codec_opening = { MG_OPEN, frame_corners, mg_call_look, opening_of }

export { run_board_theme_codec_opening }
