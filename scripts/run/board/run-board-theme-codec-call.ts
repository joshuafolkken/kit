import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Channel, Grid, Point } from './run-board-theme-host-types'

// The codec theme's display and voice (joshuafolkken/kit#8917), ported from the confirmed theme
// demo: the frequency dialing in, the voice's level, and the display — PTT over the stepped level
// meter with the frequency in its curve, MEMORY under it — the unit's frame draws.

const { centered, code_points, digit, put, repeated } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { big_number, big_width } = run_board_theme_host_fonts
const { LEFT_ARROW, STYLE, freq_at } = run_board_theme_codec_data

// A frequency dials in: a digit at a time from the left, two ticks apart, random until it locks.
const DIAL = { settle: 14, step: 2, call_salt: 7 }
// How far the voice carries, 0 to 10.
const VOICE = { low: 3, span: 7, salt: 5, pepper: 3, fall: 8, from: 4, pace: 2, blip_every: 50 }
const BLIPS = '12321'
const LEVEL_FULL = 10
const HALF = 2

const DISPLAY_W = 34
// The six bars of the display: two its whole width, the rest cut short by the curve.
const BAR_SHORT = { third: 16, fourth: 9, fifth: 7, sixth: 6 }
const BAR_LENGTHS: ReadonlyArray<number> = [
	DISPLAY_W,
	DISPLAY_W,
	BAR_SHORT.third,
	BAR_SHORT.fourth,
	BAR_SHORT.fifth,
	BAR_SHORT.sixth,
]
const DISPLAY = { label_w: 9, memory_w: 10, bars: 1, freq: 4, arrows: 3, memory: 7, side_rows: 6 }
const ARROW = { back: 9, past: 4, head_gap: 8, w: 5 }
const FREQ_HEAD = 2

// The display's level meter, as on the reference screen: horizontal bars stacked, the upper ones
// running its whole width and the lower ones cut short by the curve the frequency sits in. They
// light from the bottom as far as the voice carries (`level` of 10).
function level_bars(grid: Grid, at: Point, lengths: ReadonlyArray<number>, level: number): void {
	const lit = Math.round((level / LEVEL_FULL) * lengths.length)

	for (const [index, length] of lengths.entries()) {
		const is_on = lengths.length - 1 - index < lit

		put(
			grid,
			{ y: at.y + index, x: at.x },
			repeated('▀', length),
			is_on ? STYLE.bar_on : STYLE.bar_off,
		)
	}
}

function dialing(freq: string, age: number, tick: number, salt: number): string {
	if (age >= DIAL.settle) return freq

	return code_points(freq)
		.map((ch, index) =>
			ch === '.' || age >= DIAL.step * (index + 1) ? ch : digit(hash(tick, index, salt)),
		)
		.join('')
}

function codec_freq(talk: Pick<Channel, 'index' | 'start'>, tick: number): string {
	const freq = freq_at(Math.max(0, talk.index))

	return dialing(freq, tick - talk.start, tick, DIAL.call_salt)
}

// The voice while it talks: jumping every other tick.
function talking_level(tick: number): number {
	return (
		VOICE.low + Math.round(VOICE.span * hash(Math.floor(tick / HALF), VOICE.salt, VOICE.pepper))
	)
}

// A small blip now and then while idle.
function blip_level(tick: number): number {
	return Number(BLIPS.charAt(tick % VOICE.blip_every))
}

// How far the voice carries, 0 to 10: jumping while the progress line types, falling away after,
// and a small blip now and then while idle.
function voice_level(talk: Pick<Channel, 'cooled' | 'index' | 'is_typing'>, tick: number): number {
	if (talk.is_typing) return talking_level(tick)

	if (talk.index >= 0 && talk.cooled < VOICE.fall) {
		return Math.max(0, VOICE.from - Math.floor(talk.cooled / VOICE.pace))
	}

	return blip_level(tick)
}

// What the display shows: its label (PTT, CALL) and its style, the arrows' style, the level and
// the frequency.
interface DisplayLook {
	label: string
	label_style: string
	arrow_style: string
	level: number
	freq: string
}

function display_sides(grid: Grid, at: Point): void {
	for (let row = 0; row < DISPLAY.side_rows; row++) {
		put(grid, { y: at.y + row, x: at.x - 1 }, '▕', STYLE.side)
		put(grid, { y: at.y + row, x: at.x + DISPLAY_W }, '▏', STYLE.side)
	}
}

// The frequency: its first two digits dimmer than the rest, as on the screen.
function freq_digits(grid: Grid, at: Point, freq: string): void {
	const x = at.x + DISPLAY_W - big_width(freq)

	big_number(grid, { y: at.y, x }, freq.slice(0, FREQ_HEAD), { style: STYLE.freq_head })
	big_number(grid, { y: at.y, x: x + ARROW.head_gap }, freq.slice(FREQ_HEAD), {
		style: STYLE.codec_lit,
	})
}

function display_arrows(grid: Grid, at: Point, style: string): void {
	put(grid, { y: at.y, x: at.x - ARROW.back }, `  ${LEFT_ARROW}  `, style)
	put(grid, { y: at.y, x: at.x + DISPLAY_W + ARROW.past }, '  ▶  ', style)
	put(grid, { y: at.y + 1, x: at.x - ARROW.back }, ' '.repeat(ARROW.w), style)
	put(grid, { y: at.y + 1, x: at.x + DISPLAY_W + ARROW.past }, ' '.repeat(ARROW.w), style)
}

// The display, its label on row `at.y` and its left edge at `at.x`: the label over the level bars
// with the frequency in their curve, an arrow either side, MEMORY under it.
function codec_display(grid: Grid, at: Point, look: DisplayLook): void {
	const { x } = at
	const label_x = x + Math.floor((DISPLAY_W - DISPLAY.label_w) / HALF)
	const memory_x = x + Math.floor((DISPLAY_W - DISPLAY.memory_w) / HALF)

	put(grid, { y: at.y, x: label_x }, centered(look.label, DISPLAY.label_w), look.label_style)
	level_bars(grid, { y: at.y + DISPLAY.bars, x }, BAR_LENGTHS, look.level)
	display_sides(grid, { y: at.y + DISPLAY.bars, x })
	freq_digits(grid, { y: at.y + DISPLAY.freq, x }, look.freq)
	put(
		grid,
		{ y: at.y + DISPLAY.memory, x: memory_x },
		'  MEMORY  ',
		`${STYLE.bar_off}${STYLE.dark_box}`,
	)
	display_arrows(grid, { y: at.y + DISPLAY.arrows, x }, look.arrow_style)
}

const run_board_theme_codec_call = {
	blip_level,
	codec_display,
	codec_freq,
	dialing,
	level_bars,
	talking_level,
	voice_level,
}

export { run_board_theme_codec_call }
export type { DisplayLook }
