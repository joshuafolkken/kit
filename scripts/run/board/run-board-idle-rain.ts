import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import { run_board_rain } from './run-board-rain'

// joshuafolkken/kit#8356: the matrix board's idle rain, drawn in the lamp panel's cells — from past the
// throughput rows' NOW, every other column, on the panel's five rows — so it takes no column the board's
// text draws in. Each column has one drop falling a row in a few frames, its white-green head followed by
// three trail cells, then a gap before it falls again; while a row decodes, every drop pours at one
// faster pace. Like the lamps, a cell is read off the moment, its column and its row alone, so only the
// cells that change are written between redraws.

const { SHADES } = run_board_header_trace
const { mixed } = run_board_lamps
// The demo's live frame, the rows a drop falls a frame idle and pouring, and its gap's rows.
const FRAME_MS = 70
const SPEED = { least: 0.12, spread: 0.22 }
const POUR_SPEED = 0.8
const GAP = { least: 6, spread: 10 }
const PANEL_ROWS = 5
const TRAIL: ReadonlyArray<Paint> = [SHADES.bright, SHADES.mid, SHADES.dark]
const CYCLE_ROWS = PANEL_ROWS + TRAIL.length
// Each column's drop numbers, mixed apart from its speed, its gap and where it starts.
const SALT = { speed: 1, gap: 2, offset: 3, glyph: 4 }
const SCALE = 1000
const BLANK = ' '

// A trail cell keeps the glyph its place settles on: a random source that never rerolls.
function never(): number {
	return 1
}

interface RainMoment {
	ms: number
	is_burst: boolean
}

interface RainPlace {
	column: number
	panel_row: number
}

// A number in `0`..`1` mixed from the column and `salt`, the same for the same two.
function share(column: number, salt: number): number {
	return (mixed([column, salt]) % SCALE) / SCALE
}

// A drop's idle pace in rows a frame, `fraction` (`0`..`1`) of the way through the spread — the one pace
// the board's falling drop shares (`run-board-rain-drop.ts`; joshuafolkken/kit#8367).
function pace_of(fraction: number): number {
	return SPEED.least + fraction * SPEED.spread
}

// The rows the column's drop falls a frame: its own pace idle, one faster pace for every drop pouring.
function speed_of(column: number, at: RainMoment): number {
	return at.is_burst ? POUR_SPEED : pace_of(share(column, SALT.speed))
}

// The row the column's drop is on at `at`, fractional, within its cycle of panel, trail and gap.
function row_at(column: number, at: RainMoment): number {
	const cycle = CYCLE_ROWS + GAP.least + Math.floor(share(column, SALT.gap) * GAP.spread)
	const fallen = (at.ms / FRAME_MS) * speed_of(column, at) + share(column, SALT.offset) * cycle

	return fallen % cycle
}

// The head's glyph, changing every frame, and the same for the same column and frame.
function head_glyph(column: number, ms: number): string {
	const frame = Math.floor(ms / FRAME_MS)

	return run_board_rain.fresh(() => share(column, mixed([frame, SALT.glyph])))
}

// The cell at `place` as drawn at `at`: the head, a trail cell, or a blank.
function cell_text(place: RainPlace, at: RainMoment): string {
	const distance = Math.floor(row_at(place.column, at)) - place.panel_row

	if (distance === 0) return run_board_labels.painted(SHADES.head, head_glyph(place.column, at.ms))
	// A cell below the head has a negative index, so no paint.
	const paint = TRAIL[distance - 1]

	if (paint === undefined) return BLANK
	const glyph = run_board_rain.settled({ x: place.column, y: place.panel_row }, never)

	return run_board_labels.painted(paint, glyph)
}

const run_board_idle_rain = { SPEED, cell_text, never, pace_of, row_at, speed_of }

export { run_board_idle_rain }
export type { RainMoment, RainPlace }
