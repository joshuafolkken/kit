import { describe, expect, it } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_cells_diff } from './run-board-cells-diff'

// joshuafolkken/kit#8826: only the cells that changed are written, and the front made the back.

const { cells_of } = run_board_cells
const { paint } = run_board_cells_ansi
const { diff } = run_board_cells_diff
const ESC = '\u{1B}'
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`
const SIZE = { rows: 2, columns: 6 }

function painted(text: string): Cells {
	const cells = cells_of(SIZE)

	paint(cells, text)

	return cells
}

describe('run_board_cells_diff.diff', () => {
	it('writes nothing where nothing changed', () => {
		expect(diff(painted('abc'), painted('abc'))).toBe('')
	})

	it('writes only the changed cells after one cursor move', () => {
		const front = painted('abc\ndef')

		expect(diff(painted('abc\ndXY'), front)).toBe(`${ESC}[2;2H${RESET}XY`)
	})

	it('moves the cursor again past an unchanged cell', () => {
		expect(diff(painted('XbY'), painted('abc'))).toBe(`${ESC}[1;1H${RESET}X${ESC}[1;3HY`)
	})

	it('writes a cell whose style alone changed, then resets', () => {
		const bytes = diff(painted(`${RED}a`), painted('a'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}${RED}a${RESET}`)
	})

	it('writes a wide character whole from its first cell', () => {
		expect(diff(painted('日'), painted('ab'))).toBe(`${ESC}[1;1H${RESET}日`)
	})

	it('makes the front the back, so the same back again writes nothing', () => {
		const front = painted('abc')
		const back = painted('xyz')

		diff(back, front)

		expect(front).toStrictEqual(back)
		expect(diff(back, front)).toBe('')
	})
})
