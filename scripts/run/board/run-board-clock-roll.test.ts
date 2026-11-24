import { describe, expect, it } from 'vitest'
import { run_board_clock_roll } from './run-board-clock-roll'
import { run_board_jump_paint, type PaintCell } from './run-board-jump-paint'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8710: the bttf time circuits roll after a jump, a row after the row above, each row's
// places stopping from the left.

const { ROLL_AT, rolled_clocks } = run_board_clock_roll
const { noise } = run_board_jump_paint
const { parsed } = run_board_rgb
const GREY: Rgb = [100, 100, 100]
const WHITE = parsed('255;255;255')
const PREFIX = 'RUN #8710  '
const HEADER = [`${PREFIX}ET 11-22 19:52`, `${PREFIX}NW 11-22 18:40`, `${PREFIX}T0 11-22 18:02`]
const CLOCK_FROM = PREFIX.length + 3
const CLOCK_PLACES = 8
// The tick the top row's last place stops on, and the tick a row below stops after it.
const TOP_DONE = ROLL_AT + 6
const ROW_LAG = 4

// A row's cells, a blank where `skip` names a letter (the blinking colons the spinners own).
function row_of(text: string, y: number, skip = ''): Array<PaintCell> {
	return [...text]
		.map((letter, x) => ({ x, y, text: letter, fg: GREY, is_figure: false }))
		.filter((cell) => !skip.includes(cell.text))
}

function is_white(cell: PaintCell): boolean {
	return cell.fg.join(',') === WHITE.join(',')
}

function header(skip = ''): Array<PaintCell> {
	return HEADER.flatMap((text, y) => row_of(text, y, skip))
}

// The clock places of row `y` spinning: each white one, left to right.
function spinning_of(cells: ReadonlyArray<PaintCell>, y: number): Array<boolean> {
	return cells
		.filter((cell) => cell.y === y && cell.x >= CLOCK_FROM && /\d/u.test(HEADER[y]?.[cell.x] ?? ''))
		.map((cell) => is_white(cell))
}

function text_of(cells: ReadonlyArray<PaintCell>, y: number): string {
	return cells
		.filter((cell) => cell.y === y)
		.map((cell) => cell.text)
		.join('')
}

describe('run_board_clock_roll.rolled_clocks — when the roll runs', () => {
	it('leaves the board as it is before ROLL_AT ticks past the jump', () => {
		const cells = header()

		expect(rolled_clocks(cells, ROLL_AT - 1, noise)).toStrictEqual(cells)
	})

	it('spins the clock places white from ROLL_AT, and nothing but the clock time', () => {
		const rolled = rolled_clocks(header(), ROLL_AT, noise)
		const white = rolled.filter((cell) => is_white(cell))

		expect(white.length).toBeGreaterThan(0)
		expect(white.every((cell) => cell.x >= CLOCK_FROM && /\d/u.test(cell.text))).toBe(true)
		expect(white.every((cell) => cell.bg === undefined)).toBe(true)
	})

	it('leaves every clock on the board as drawn — the new estimate — once the last row stops', () => {
		const cells = header()

		expect(rolled_clocks(cells, TOP_DONE + ROW_LAG * 2, noise)).toStrictEqual(cells)
		expect(text_of(rolled_clocks(cells, TOP_DONE, noise), 0)).toBe(HEADER[0])
	})
})

describe('run_board_clock_roll.rolled_clocks — the order the places stop', () => {
	it('stops a row from the left: a stopped place never sits right of a spinning one', () => {
		const rolled = rolled_clocks(header(), ROLL_AT + 2, noise)
		const top = spinning_of(rolled, 0)

		expect(top).toHaveLength(CLOCK_PLACES)
		expect(top.slice(0, top.indexOf(true))).not.toContain(true)
		expect(top.slice(top.indexOf(true))).not.toContain(false)
		expect(top.at(0)).toBe(false)
		expect(top.at(-1)).toBe(true)
	})

	it('stops the top row first, each row below a few ticks after the row above', () => {
		const rolled = rolled_clocks(header(), TOP_DONE, noise)
		const later = rolled_clocks(header(), TOP_DONE + ROW_LAG, noise)

		expect(spinning_of(rolled, 0)).not.toContain(true)
		expect(spinning_of(rolled, 1)).toContain(true)
		expect(spinning_of(later, 1)).not.toContain(true)
		expect(spinning_of(later, 2)).toContain(true)
	})
})

describe('run_board_clock_roll.rolled_clocks — the board below the header', () => {
	// joshuafolkken/kit#8826: one scan of the board, and no copy of a cell the roll leaves alone.
	it('returns the very same cell objects for the cells the roll does not spin', () => {
		const below = row_of('BOARD ROW 12:34', HEADER.length)
		const cells = [...header(), ...below]
		const rolled = rolled_clocks(cells, ROLL_AT, noise)

		for (const cell of below) expect(rolled[cells.indexOf(cell)]).toBe(cell)
		expect(rolled).toHaveLength(cells.length)
		expect(rolled.some((cell) => is_white(cell))).toBe(true)
	})
})

describe('run_board_clock_roll.rolled_clocks — finding the clock', () => {
	it('finds the clock where the blinking colons are left out of the cells', () => {
		const rolled = rolled_clocks(header(':'), ROLL_AT, noise)

		expect(rolled.some((cell) => is_white(cell))).toBe(true)
	})

	it('leaves a header with no clock label as it is', () => {
		const cells = row_of('RUN 11-22 19:52', 0)

		expect(rolled_clocks(cells, ROLL_AT, noise)).toStrictEqual(cells)
	})
})
