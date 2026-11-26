import { run_board_theme_codec_call } from './run-board-theme-codec-call'
import type { Codec, Paint } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_face_cells } from './run-board-theme-codec-face-cells'
import { run_board_theme_codec_face_fit, type FaceLook } from './run-board-theme-codec-face-fit'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Channel, Grid, Point } from './run-board-theme-host-types'

// The codec theme's call (joshuafolkken/kit#8917), ported from the confirmed theme demo's
// `fixed-v22-theme-demo.mjs` (`panel_codec`): PROGRESS calls inside the panel, the THROUGHPUT and
// USAGE data left as they are — a bust portrait at either end of the panel's rows, and between
// them PTT over a narrowed display (two whole bars, then the frequency with a stub of the lower
// bars beside it) over MEMORY.

const { codec_freq, voice_level } = run_board_theme_codec_call
const { STYLE } = run_board_theme_codec_data
const { BUST } = run_board_theme_codec_face_cells
const { bust_portrait } = run_board_theme_codec_face_fit
const { big_number, big_width } = run_board_theme_host_fonts
const { bg, fg, put, repeated } = run_board_theme_host_grid

const HALF = 2
const LEVEL_FULL = 10
// The display between the portraits: a cell's gap either side of it.
const GAP = 1
const LABEL = { ptt: '   PTT   ', memory: '  MEMORY  ' }
const ROWS = { bars: 1, freq: 3 }
const FREQ = { head: 2, gap: 8 }
const BLINK = { every: 53, ticks: 2 }
const RULE = fg('28;84;48')
// A bar's color, lit or not; every second bar a shade darker, so bars that touch still read apart.
const BAR_COLORS = { lit: ['200;255;215', '150;225;175'], unlit: ['40;95;60', '26;68;42'] }
// The stub lengths of the lower eight bars, their ends following the curve the frequency sits in.
const STUB = { sweep: 13, inner: 7, mid: 3, low: 2 }
const BAR_STUBS: ReadonlyArray<number> = [
	STUB.sweep,
	STUB.inner,
	STUB.mid,
	STUB.mid,
	STUB.mid,
	STUB.low,
	STUB.low,
	STUB.low,
]

function display_w(pw: number): number {
	return pw - HALF * BUST.columns - HALF * GAP
}

// The panel's level bars: two to a row with no gap between them, ten in all.
function panel_bars(width: number): ReadonlyArray<number> {
	return [width, width, ...BAR_STUBS]
}

function bar_color(lengths: ReadonlyArray<number>, level: number, index: number): string {
	const is_on = lengths.length - 1 - index < Math.round((level / LEVEL_FULL) * lengths.length)

	return (is_on ? BAR_COLORS.lit : BAR_COLORS.unlit)[index % HALF] ?? ''
}

// A cell holds the upper bar as its top half and the lower bar as its bottom half.
function bar_pair(
	grid: Grid,
	at: Point,
	upper: { length: number; color: string },
	lower: { length: number; color: string },
): void {
	const both = Math.min(upper.length, lower.length)

	put(grid, at, repeated('▀', both), `${fg(upper.color)}${bg(lower.color)}`)

	if (upper.length > both) {
		put(grid, { y: at.y, x: at.x + both }, repeated('▀', upper.length - both), fg(upper.color))
	}

	if (lower.length > both) {
		put(grid, { y: at.y, x: at.x + both }, repeated('▄', lower.length - both), fg(lower.color))
	}
}

function fine_bars(grid: Grid, at: Point, lengths: ReadonlyArray<number>, level: number): void {
	for (let index = 0; index < lengths.length; index += HALF) {
		const upper = { length: lengths[index] ?? 0, color: bar_color(lengths, level, index) }
		const lower = { length: lengths[index + 1] ?? 0, color: bar_color(lengths, level, index + 1) }

		bar_pair(grid, { y: at.y + index / HALF, x: at.x }, upper, lower)
	}
}

function face_look(is_talking: boolean, tick: number): FaceLook {
	return {
		is_talking,
		tick,
		is_open: is_talking && Math.floor(tick / HALF) % HALF === 0,
		is_blink: tick % BLINK.every < BLINK.ticks,
	}
}

// The commander at the panel's left end talks on even progress lines, the operative at its right
// end on odd ones.
function panel_faces(grid: Grid, codec: Codec, talk: Channel, tick: number): void {
	const { px, edge, area_top } = codec.layout
	const y = area_top + 1
	const is_left = talk.index % HALF === 0

	bust_portrait(grid, { y, x: px }, 'commander', face_look(talk.is_typing && is_left, tick))
	bust_portrait(
		grid,
		{ y, x: edge - BUST.columns },
		'operative',
		face_look(talk.is_typing && !is_left, tick),
	)
}

function display_frame(grid: Grid, codec: Codec, x: number, is_typing: boolean): void {
	const { pw, area_top, area_end } = codec.layout
	const width = display_w(pw)
	const top = area_top + 1
	const ptt_style = is_typing ? STYLE.codec_lit : STYLE.green_dim

	for (const y of [top, area_end]) put(grid, { y, x }, repeated('─', width), RULE)
	put(
		grid,
		{ y: top, x: x + Math.floor((width - LABEL.ptt.length) / HALF) },
		LABEL.ptt,
		`${ptt_style}${STYLE.dark_box}`,
	)
	put(
		grid,
		{ y: area_end, x: x + Math.floor((width - LABEL.memory.length) / HALF) },
		LABEL.memory,
		`${STYLE.bar_off}${STYLE.dark_box}`,
	)

	for (let y = top + ROWS.bars; y < area_end; y++) {
		put(grid, { y, x: x - 1 }, '▕', STYLE.side)
		put(grid, { y, x: x + width }, '▏', STYLE.side)
	}
}

// The frequency, right-aligned in the display: its first two digits dimmer than the rest.
function panel_freq(grid: Grid, at: Point, width: number, freq: string): void {
	const x = at.x + width - big_width(freq)

	big_number(grid, { y: at.y, x }, freq.slice(0, FREQ.head), { style: STYLE.freq_head })
	big_number(grid, { y: at.y, x: x + FREQ.gap }, freq.slice(FREQ.head), {
		style: STYLE.codec_lit,
	})
}

function clear_panel(grid: Grid, codec: Codec): void {
	const { px, pw, area_top, area_end } = codec.layout

	for (let y = area_top + 1; y <= area_end; y++) put(grid, { y, x: px }, ' '.repeat(pw), '')
}

// The codec call inside the panel.
function codec_screen(codec: Codec, paint: Paint): void {
	const { grid, s, tick } = paint
	const talk = s.progress
	const { px, pw, area_top } = codec.layout
	const width = display_w(pw)
	const x = px + BUST.columns + GAP

	clear_panel(grid, codec)
	panel_faces(grid, codec, talk, tick)
	display_frame(grid, codec, x, talk.is_typing)
	fine_bars(grid, { y: area_top + 1 + ROWS.bars, x }, panel_bars(width), voice_level(talk, tick))
	panel_freq(grid, { y: area_top + 1 + ROWS.freq, x }, width, codec_freq(talk, tick))
}

const run_board_theme_codec_talk = {
	bar_color,
	codec_screen,
	display_w,
	face_look,
	panel_bars,
}

export { run_board_theme_codec_talk }
