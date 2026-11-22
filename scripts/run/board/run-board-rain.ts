import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'

// joshuafolkken/kit#8442: the matrix board's code rain, one part every rain effect draws through — the
// first frame's reveal (joshuafolkken/kit#8519), the idle rain and the exit wipe. Each column of the
// screen has a head falling at its own speed from its own start; a cell at the head is a fresh white-green
// glyph, the tail above it fades through the trace greens over the column's own length; the cells above
// the tail the rain has passed (`behind`), and the cells below the head it has not reached (`ahead`).
// What those show is the caller's: a reveal leaves its frame behind the rain, a wipe leaves blanks. The
// random source is injected, so a test pins every glyph, speed and tail.

type Random = () => number

interface Head {
	// The row the head is on, fractional between frames, and the rows it falls per frame.
	at: number
	speed: number
	// The tail's cells above the head, and their paint from the head upward, stretched over them.
	length: number
	ramp: ReadonlyArray<Paint>
}

// At least `least`, and up to `spread` more.
interface Span {
	least: number
	spread: number
}

// joshuafolkken/kit#8626: one pass's own rain — each column's tail as a share of the screen's height,
// the tail's paint, each head's speed in rows a frame, and how long every head keeps that speed before
// it gains one more for each second past the hold.
interface Scene {
	tail: Span
	ramp: ReadonlyArray<Paint>
	speed: Span
	hold_ms: number
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
const SPEED: Span = { least: 0.55, spread: 0.75 }
const SECOND_MS = 1000
const HOLD_MS = 3000
// The odds a tail cell rerolls its glyph on a frame, else it keeps the glyph its place settles on.
const REROLL = 0.08
const SETTLE = { x: 31, y: 17 }
// Half-width katakana, digits and signs, each one UTF-16 unit and one terminal column.
const GLYPHS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+<>'
const { SHADES } = run_board_header_trace
// The tail's paint by its distance above the head, nearest first: the wipe's, and on a seven-cell tail
// each cell its own step.
const FADE: ReadonlyArray<Paint> = [
	SHADES.bright,
	SHADES.bright,
	SHADES.body,
	SHADES.mid,
	SHADES.mid,
	SHADES.dark,
	SHADES.darkest,
]
// The reveal's paint: bright for longer, dark only at the very end of the tail.
const MOVIE_RAMP: ReadonlyArray<Paint> = [
	SHADES.bright,
	SHADES.bright,
	SHADES.bright,
	SHADES.body,
	SHADES.body,
	SHADES.body,
	SHADES.body,
	SHADES.mid,
	SHADES.mid,
	SHADES.mid,
	SHADES.dark,
	SHADES.darkest,
]
// The first frame's reveal: tails one to two screens long at today's pace.
const REVEAL: Scene = {
	tail: { least: 1, spread: 1 },
	ramp: MOVIE_RAMP,
	speed: SPEED,
	hold_ms: HOLD_MS,
}
// The exit wipe: tails 40% to 100% of the screen, falling twice today's pace.
const WIPE: Scene = {
	tail: { least: 0.4, spread: 0.6 },
	ramp: FADE,
	speed: { least: 1.1, spread: 1.5 },
	hold_ms: HOLD_MS,
}

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

function spanned(span: Span, random: Random): number {
	return span.least + random() * span.spread
}

// A column's head, its start drawn before its speed and its speed before its tail.
function head_of(scene: Scene, height: number, random: Random): Head {
	const at = 0 - pick(START_ROWS, random)
	const speed = spanned(scene.speed, random)
	const length = Math.round(height * spanned(scene.tail, random))

	return { at, speed, length, ramp: scene.ramp }
}

// One head a column.
function heads_of(size: Size, scene: Scene, random: Random): Array<Head> {
	return Array.from({ length: size.width }, () => head_of(scene, size.height, random))
}

// How many times its own speed every head falls at `elapsed_ms` into the pass: once through the hold,
// then one more for each second past it.
function hurried(scene: Scene, elapsed_ms: number): number {
	return 1 + Math.max(0, elapsed_ms - scene.hold_ms) / SECOND_MS
}

function advanced(heads: ReadonlyArray<Head>, hurry = 1): Array<Head> {
	return heads.map((head) => ({ ...head, at: head.at + head.speed * hurry }))
}

// Whether every column's tail has fallen past the screen's last row.
function is_through(heads: ReadonlyArray<Head>, height: number): boolean {
	return heads.every((head) => head.at - head.length >= height)
}

// The paint `distance` cells above the head in a tail of `length` cells, the ramp stretched over the
// tail; none past the tail.
function paint_of(ramp: ReadonlyArray<Paint>, distance: number, length: number): Paint | undefined {
	if (distance > length) return undefined

	return ramp[Math.min(ramp.length - 1, Math.floor(((distance - 1) / length) * ramp.length))]
}

function cell_of(head: Head, place: Place, random: Random): RainCell {
	const distance = Math.floor(head.at) - place.y
	if (distance < 0) return { kind: 'ahead' }
	if (distance === 0) return { kind: 'drop', glyph: fresh(random), paint: SHADES.head }
	const paint = paint_of(head.ramp, distance, head.length)
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
function* passes(
	size: Size,
	random: Random,
	scene: Scene = REVEAL,
): Generator<Array<Array<RainCell>>> {
	let heads = heads_of(size, scene, random)
	let elapsed_ms = 0

	while (!is_through(heads, size.height)) {
		yield cells_of(heads, size.height, random)
		heads = advanced(heads, hurried(scene, elapsed_ms))
		elapsed_ms += RAIN_MS
	}
}

const run_board_rain = {
	FADE,
	GLYPHS,
	MOVIE_RAMP,
	RAIN_MS,
	REVEAL,
	WIPE,
	advanced,
	cell_of,
	cells_of,
	fresh,
	heads_of,
	hurried,
	paint_of,
	passes,
	settled,
}

export { run_board_rain }
export type { Drop, Head, Place, RainCell, Random, Scene, Size }
