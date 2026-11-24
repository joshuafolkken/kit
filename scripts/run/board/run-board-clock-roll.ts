import type { PaintCell } from './run-board-jump-paint'
import { run_board_rgb } from './run-board-rgb'

// joshuafolkken/kit#8710: the bttf time circuits roll after a jump. From `ROLL_AT` ticks past the jump
// the digits and letters of the header's three clocks spin white, a row stopping after the row above
// and each row's places from the left. The roll spins over the board as drawn now, so the destination
// stops on the estimate the header shows after the merge. The clock is found by its theme label
// (`ET`, `NW`, `T0`); a column no cell stands in is a blinking colon the spinners own.

const { parsed } = run_board_rgb

const ROLL_AT = 12
// A row stops `ROLL_LEAD` ticks past `ROLL_AT`, `ROW_LAG` more a row down, a place every `PLACE_TICKS`.
const ROLL_LEAD = 6
const ROW_LAG = 4
const PLACE_TICKS = 2
const HEADER_ROWS = 3
// Each tick moves the spin's noise this far.
const TICK_SHIFT = 17.3
const WHITE = parsed('255;255;255')
const DIGITS = '0123456789'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const CLOCK = /(?:ET|NW|T0) ((?:\d\d-\d\d )?\d\d:\d\d)/u
const ROLLED = /[\dA-Z]/u
const DIGIT = /\d/u
const GAP = ':'
const WIDE = '?'

type Noise = (x: number, y: number) => number

// A row's text a letter a column: a column no cell stands in reads as a colon, a wide letter as one.
function text_of(row: ReadonlyArray<PaintCell>): string {
	const texts = Array.from({ length: Math.max(0, ...row.map((cell) => cell.x + 1)) }, () => GAP)

	for (const cell of row) texts[cell.x] = cell.text.length === 1 ? cell.text : WIDE

	return texts.join('')
}

// The columns of a row's clock time, none where the row has no clock.
function clock_span(row: ReadonlyArray<PaintCell>): { from: number; to: number } | undefined {
	const match = CLOCK.exec(text_of(row))

	if (match === null) return undefined
	const [whole, time = ''] = match
	const to = match.index + whole.length

	return { from: to - time.length, to }
}

// The clock cells of header row `y` still spinning `t` ticks from the jump: the left places stop first.
function spinning_of(row: ReadonlyArray<PaintCell>, y: number, t: number): Array<PaintCell> {
	const span = clock_span(row)

	if (span === undefined) return []
	const places = row.filter(
		(cell) => cell.x >= span.from && cell.x < span.to && ROLLED.test(cell.text),
	)
	const left = (ROLL_AT + ROLL_LEAD + y * ROW_LAG - t) / PLACE_TICKS

	return places.filter((_, place) => left > places.length - 1 - place)
}

// A spinning cell `t` ticks from the jump: a white digit for a digit, a white letter for a letter.
function spun(cell: PaintCell, t: number, noise: Noise): PaintCell {
	const set = DIGIT.test(cell.text) ? DIGITS : LETTERS
	const text = set[Math.floor(noise(cell.x + t * TICK_SHIFT, cell.y) * set.length)] ?? cell.text

	return { ...cell, text, fg: WHITE, bg: undefined }
}

// joshuafolkken/kit#8826: the header's rows gathered in one pass over the board, not a scan a row.
function header_rows_of(cells: ReadonlyArray<PaintCell>): Array<Array<PaintCell>> {
	const rows = Array.from({ length: HEADER_ROWS }, (): Array<PaintCell> => [])

	for (const cell of cells) rows[cell.y]?.push(cell)

	return rows
}

// The board `t` ticks from the jump with its header's clocks rolling, as it is before `ROLL_AT`.
function rolled_clocks(cells: ReadonlyArray<PaintCell>, t: number, noise: Noise): Array<PaintCell> {
	if (t < ROLL_AT) return [...cells]
	const spinning = new Set(header_rows_of(cells).flatMap((row, y) => spinning_of(row, y, t)))

	return cells.map((cell) => (spinning.has(cell) ? spun(cell, t, noise) : cell))
}

const run_board_clock_roll = { ROLL_AT, rolled_clocks }

export { run_board_clock_roll }
