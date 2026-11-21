import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_drop_screen, type DropScreen, type ScreenPlace } from './run-board-drop-screen'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import { run_board_rain } from './run-board-rain'
import { run_board_sweep } from './run-board-sweep'

// joshuafolkken/kit#8367: the matrix board's drop, in place of the wargames sweep. On every second one
// drop enters the top row in a column drawn at random and falls down the whole board at the idle rain
// panel's pace (`run_board_idle_rain.pace_of`), a step every `DROP_MS`, until its trail falls past the
// frame's last row on screen. A blank cell it passes shows code; a cell with text keeps its character,
// white at the head and bright for the two cells behind it, so a drop never hides what the board says.
// Each drop is read off the clock and the second it entered on, so a turn writes only the cells that
// changed since the last one.

const { SHADES } = run_board_header_trace
const { cell_at, is_kept, key_of } = run_board_drop_screen
const DROP_MS = run_board_sweep.SWEEP_MS
const TRAIL: ReadonlyArray<Paint> = [SHADES.bright, SHADES.mid, SHADES.dark, SHADES.darkest]
const LIT_TRAIL = 2
const SALT = { column: 1, speed: 2, glyph: 3 }
const SCALE = 1000
const CSI = '\u{1B}['
const { RESET } = run_board_cut_styled

// A number in `0`..`1` drawn for the values, the same for the same ones: the drop's random source.
type Share = (values: ReadonlyArray<number>) => number

interface Fall {
	born_ms: number
	column: number
	speed: number
}

function mixed_share(values: ReadonlyArray<number>): number {
	return (run_board_lamps.mixed(values) % SCALE) / SCALE
}

// The drop that entered on the second `born_ms`: its column and its pace.
function fall_of(born_ms: number, columns: number, share: Share): Fall {
	const column = 1 + Math.min(columns - 1, Math.floor(share([born_ms, SALT.column]) * columns))

	return { born_ms, column, speed: run_board_idle_rain.pace_of(share([born_ms, SALT.speed])) }
}

function steps_of(fall: Fall, at_ms: number): number {
	return Math.floor((at_ms - fall.born_ms) / DROP_MS)
}

// The screen row the drop's head is on: the top row on the second it enters.
function head_row(fall: Fall, at_ms: number): number {
	return 1 + Math.floor(steps_of(fall, at_ms) * fall.speed)
}

// The drops on the screen at `at_ms`: one entered on each second, back as far as the slowest could still
// have its trail on the frame's last row.
function falls_at(screen: DropScreen, at_ms: number, share: Share): Array<Fall> {
	const bottom = screen.rows.length
	const reach_ms = Math.ceil((bottom + TRAIL.length) / run_board_idle_rain.pace_of(0)) * DROP_MS
	const last = Math.floor(at_ms / MS_PER_SECOND)
	const first = Math.max(0, Math.floor((at_ms - reach_ms) / MS_PER_SECOND))
	const seconds = Array.from({ length: last - first + 1 }, (_second, index) => first + index)

	return seconds
		.map((second) => fall_of(second * MS_PER_SECOND, screen.columns, share))
		.filter((fall) => head_row(fall, at_ms) - TRAIL.length <= bottom)
}

// A blank cell under the drop: a fresh glyph at the head every step, a settled one in the trail.
function code_glyph(fall: Fall, place: ScreenPlace, at_ms: number): string {
	const { row, column } = place
	const step = steps_of(fall, at_ms)

	if (head_row(fall, at_ms) === row) {
		return run_board_rain.fresh(() => mixed_share([fall.born_ms, step, SALT.glyph]))
	}

	return run_board_rain.settled({ x: column, y: row }, run_board_idle_rain.never)
}

// What the drop draws in its `index`th cell (0 the head): code in a blank, the cell's own character lit
// in one with text, or nothing where the cell keeps its own colors.
function lit_text(
	screen: DropScreen,
	place: ScreenPlace,
	index: number,
	glyph: () => string,
): string | undefined {
	const { text } = cell_at(screen, place)
	const paint = index === 0 ? SHADES.head : TRAIL[index - 1]

	if (text === ' ') return run_board_labels.painted(paint, glyph())
	if (index === 0) return run_board_labels.painted(SHADES.head, text)

	return index <= LIT_TRAIL ? run_board_labels.painted(SHADES.bright, text) : undefined
}

// The drop's cells on the screen at `at_ms`, each as written, by `row;column`.
function fall_cells(screen: DropScreen, fall: Fall, at_ms: number): Array<[string, string]> {
	const head = head_row(fall, at_ms)

	return Array.from({ length: TRAIL.length + 1 }, (_cell, index) => ({
		row: head - index,
		column: fall.column,
	})).flatMap((place, index) => {
		if (place.row < 1 || place.row > screen.rows.length || is_kept(screen, place)) return []
		const text = lit_text(screen, place, index, () => code_glyph(fall, place, at_ms))

		return text === undefined ? [] : [[key_of(place), text]]
	})
}

function lit_cells(screen: DropScreen, at_ms: number, share: Share): Map<string, string> {
	return new Map(falls_at(screen, at_ms, share).flatMap((fall) => fall_cells(screen, fall, at_ms)))
}

// The cell at `row;column` put back as the frame drew it.
function restored(screen: DropScreen, key: string): string {
	const [row = 0, column = 0] = key.split(';').map(Number)
	const cell = cell_at(screen, { row, column })

	return `${CSI}${key}H${RESET}${cell.style}${cell.text}${RESET}`
}

// The drops moved from `since_ms` to `at_ms`: the cells they left put back, the cells they lit written —
// every one where there is no `since_ms`.
function drop_bytes(
	screen: DropScreen | undefined,
	at_ms: number,
	since_ms: number | undefined,
	share: Share = mixed_share,
): string {
	if (screen === undefined) return ''
	const now = lit_cells(screen, at_ms, share)
	const before =
		since_ms === undefined ? new Map<string, string>() : lit_cells(screen, since_ms, share)
	const left = [...before.keys()].filter((key) => !now.has(key)).map((key) => restored(screen, key))
	const lit = [...now]
		.filter(([key, text]) => before.get(key) !== text)
		.map(([key, text]) => `${CSI}${key}H${RESET}${text}`)

	return [...left, ...lit].join('')
}

const run_board_rain_drop = { DROP_MS, drop_bytes, falls_at, head_row }

export { run_board_rain_drop }
export type { Fall, Share }
