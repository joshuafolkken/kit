import { run_board_theme_codec_call } from './run-board-theme-codec-call'
import type { Codec } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_unit, type UnitLook } from './run-board-theme-codec-unit'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import type { Cell, Grid, ThemePart } from './run-board-theme-host-types'

// The codec theme's ending (joshuafolkken/kit#8917), ported from the confirmed theme demo: the codec
// opens from a line over the board, which dims; the voice falls away, the board breaks up into
// static and the frequency drifts off; then the whole picture closes to a green line, the line
// draws in to a dot, the dot blinks out, and a second of empty screen.

const { bg, code_points, digit, dimmed, fg, mixed, pick } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { eased } = run_board_theme_host_parts
const { GREEN, freq_at } = run_board_theme_codec_data
const { talking_level } = run_board_theme_codec_call
const { MG_DIM, MG_GLOW, codec_unit, codec_window } = run_board_theme_codec_unit

const MG_END = { opened: 6, drop: 20, close: 36, line: 52, dot: 62, gone: 70, ticks: 90 }
const STATIC = { dim_from: 2, from: 10, spread: 24, glyphs: '░▒▓·', drift: 0.1 }
const SALT = { share: 61, glyph: 62, grey: 63, drift: 64, freq: 65 }
const STATIC_GREYS: ReadonlyArray<string> = ['60;60;60', '110;110;110', GREEN.shade]
const SIGN_OFF = { digits: 6, from: 6, pace: 2 }
const DOT = { every: 4, lit: 2 }
const WINDOW_HALF = 5
const HALF = 2

// A cell of the board breaking up: a few of them flicker as the static drifts.
function static_cell(x: number, y: number, tick: number): Cell {
	const seed = hash(x, y, SALT.drift) < STATIC.drift ? Math.floor(tick / HALF) : 0
	const glyph = pick(STATIC.glyphs, hash(x, y, SALT.glyph + seed))

	return [glyph, fg(pick(STATIC_GREYS, hash(y, x, SALT.grey)))]
}

function static_row(row: Array<Cell>, y: number, tick: number, share: number): void {
	for (const [x, [ch]] of row.entries()) {
		if (ch !== ' ' && hash(x, y, SALT.share) < share) row[x] = static_cell(x, y, tick)
	}
}

// The board dims, then breaks up into static from a few cells to all of them.
function mg_static(grid: Grid, tick: number): void {
	if (tick >= STATIC.dim_from) dimmed(grid, MG_DIM)
	const share = Math.min(1, Math.max(0, (tick - STATIC.from) / STATIC.spread))

	for (const [y, row] of grid.entries()) static_row(row, y, tick, share)
}

// The frequency drifts off, from its last digit back.
function drifting_freq(tick: number): string {
	const settled = MG_END.drop + SIGN_OFF.pace * SIGN_OFF.digits

	return code_points(freq_at(0))
		.map((ch, index) =>
			ch === '.' || tick < settled - SIGN_OFF.pace * index
				? ch
				: digit(hash(tick, index, SALT.freq)),
		)
		.join('')
}

function mg_sign_off_look(tick: number): UnitLook {
	const is_talking = tick < MG_END.drop
	const fallen = Math.max(0, SIGN_OFF.from - Math.floor((tick - MG_END.drop) / SIGN_OFF.pace))

	return {
		label: 'PTT',
		is_lit: is_talking,
		level: is_talking ? talking_level(tick) : fallen,
		freq: drifting_freq(tick),
	}
}

function closing_tube(codec: Codec, grid: Grid, tick: number): void {
	const { w, h } = codec.layout
	const closing = 1 - eased((tick - MG_END.close + 1) / (MG_END.line - MG_END.close))

	codec.api.tube_picture(grid, { w, h: Math.floor(closing * (h / HALF)) }, MG_GLOW)
}

function drawing_tube(codec: Codec, grid: Grid, tick: number): void {
	const drawing = 1 - eased((tick - MG_END.line + 1) / (MG_END.dot - MG_END.line))
	const half_w = Math.max(1, Math.floor(drawing * (codec.layout.w / HALF)))

	codec.api.tube_picture(grid, { w: half_w, h: 0 }, MG_GLOW)
}

function dot_tube(codec: Codec, grid: Grid, tick: number): void {
	const fade = (tick - MG_END.dot) / (MG_END.gone - MG_END.dot)
	const glow = bg(mixed(GREEN.ok, '10;40;20', fade))

	codec.api.tube_picture(grid, { w: tick % DOT.every < DOT.lit ? 1 : 0, h: 0 }, glow)
}

// The whole picture closes to a green line, the line draws in to a dot, the dot blinks out.
function ending_tube(codec: Codec, grid: Grid, tick: number): void {
	if (tick < MG_END.line) closing_tube(codec, grid, tick)
	else if (tick < MG_END.dot) drawing_tube(codec, grid, tick)
	else dot_tube(codec, grid, tick)
}

function ending_draw(codec: Codec, grid: Grid, tick: number): void {
	if (tick >= MG_END.gone) {
		codec.api.blank_screen(grid)

		return
	}

	mg_static(grid, tick)
	const under = grid.map((row) => [...row])

	codec_unit(codec, grid, mg_sign_off_look(tick))

	if (tick < MG_END.opened) {
		codec_window(codec, grid, under, Math.round((WINDOW_HALF * (tick + 1)) / MG_END.opened))
	}

	if (tick >= MG_END.close) ending_tube(codec, grid, tick)
}

function ending_of(codec: Codec): ThemePart {
	return {
		ticks: MG_END.ticks,
		note: 'the codec signs off: the board dims and breaks into static, 140.85 drifts, the picture closes to a green line and a dot',
		draw: (grid, tick) => {
			ending_draw(codec, grid, tick)
		},
	}
}

const run_board_theme_codec_ending = { MG_END, drifting_freq, ending_of, mg_sign_off_look }

export { run_board_theme_codec_ending }
