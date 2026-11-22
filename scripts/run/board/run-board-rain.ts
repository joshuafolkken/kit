import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'

// joshuafolkken/kit#8442: the matrix board's code rain, one part every rain effect draws through — the
// first frame's reveal (joshuafolkken/kit#8519), the idle rain and the exit wipe. Each column of the
// screen has a head falling at its own speed from its own start; a cell at the head is a fresh white-green
// glyph, the seven cells above it fade through the trace greens; the cells above those the rain has
// passed (`behind`), and the cells below the head it has not reached (`ahead`). What those show is the
// caller's: a reveal leaves its frame behind the rain, a wipe leaves blanks. The random source is
// injected, so a test pins every glyph and speed.

type Random = () => number

interface Head {
	// The row the head is on, fractional between frames, and the rows it falls per frame.
	at: number
	speed: number
}

interface Place {
	x: number
	y: number
}

interface Drop {
	kind: 'drop'
	glyph: string
	paint: Paint
}

// A cell the head has not reached, one the whole tail has passed, or a glyph of the rain itself.
type RainCell = Drop | { kind: 'ahead' } | { kind: 'behind' }

interface Size {
	width: number
	height: number
}

const RAIN_MS = 45
// A column's head starts on the top row or up to one fewer than this many rows above it, and falls
// at least `least` rows a frame and up to `spread` more.
const START_ROWS = 24
const SPEED = { least: 0.55, spread: 0.75 }
// The odds a tail cell rerolls its glyph on a frame, else it keeps the glyph its place settles on.
const REROLL = 0.08
const SETTLE = { x: 31, y: 17 }
// Half-width katakana, digits and signs, each one UTF-16 unit and one terminal column.
const GLYPHS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+<>'
const { SHADES } = run_board_header_trace
// The tail's paint by its distance above the head, nearest first.
const FADE: ReadonlyArray<Paint> = [
	SHADES.bright,
	SHADES.bright,
	SHADES.body,
	SHADES.mid,
	SHADES.mid,
	SHADES.dark,
	SHADES.darkest,
]

function pick(limit: number, random: Random): number {
	return Math.floor(random() * limit)
}

function glyph_at(index: number): string {
	return GLYPHS.charAt(index % GLYPHS.length)
}

function fresh(random: Random): string {
	return glyph_at(pick(GLYPHS.length, random))
}

// The glyph a tail cell keeps from frame to frame, unless it rerolls.
function settled(place: Place, random: Random): string {
	if (random() < REROLL) return fresh(random)

	return glyph_at(place.x * SETTLE.x + place.y * SETTLE.y)
}

// One head a column, its start drawn before its speed.
function heads_of(width: number, random: Random): Array<Head> {
	return Array.from({ length: width }, () => ({
		at: 0 - pick(START_ROWS, random),
		speed: SPEED.least + random() * SPEED.spread,
	}))
}

function advanced(heads: ReadonlyArray<Head>): Array<Head> {
	return heads.map((head) => ({ ...head, at: head.at + head.speed }))
}

// Whether every column's tail has fallen past the screen's last row.
function is_through(heads: ReadonlyArray<Head>, height: number): boolean {
	return heads.every((head) => head.at - FADE.length >= height)
}

function cell_of(head: Head, place: Place, random: Random): RainCell {
	const distance = Math.floor(head.at) - place.y
	if (distance < 0) return { kind: 'ahead' }
	if (distance === 0) return { kind: 'drop', glyph: fresh(random), paint: SHADES.head }
	const paint = FADE[distance - 1]
	if (paint === undefined) return { kind: 'behind' }

	return { kind: 'drop', glyph: settled(place, random), paint }
}

// The screen's cells under the heads, a row at a time from the top.
function cells_of(
	heads: ReadonlyArray<Head>,
	height: number,
	random: Random,
): Array<Array<RainCell>> {
	return Array.from({ length: height }, (_row, y) =>
		heads.map((head, x) => cell_of(head, { x, y }, random)),
	)
}

// Every frame of one pass over a screen of this size, the heads advancing between frames, until the
// last tail has fallen past the bottom; the caller paces them `RAIN_MS` apart.
function* passes(size: Size, random: Random): Generator<Array<Array<RainCell>>> {
	let heads = heads_of(size.width, random)

	while (!is_through(heads, size.height)) {
		yield cells_of(heads, size.height, random)
		heads = advanced(heads)
	}
}

const run_board_rain = {
	FADE,
	GLYPHS,
	RAIN_MS,
	advanced,
	cell_of,
	cells_of,
	fresh,
	heads_of,
	passes,
	settled,
}

export { run_board_rain }
export type { Drop, Head, Place, RainCell, Random, Size }
