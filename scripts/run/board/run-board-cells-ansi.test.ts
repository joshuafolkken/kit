import { describe, expect, it } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'

// joshuafolkken/kit#8826: ANSI text painted onto cells as a terminal draws it.

const { CONTINUATION, DEFAULT_STYLE, cells_of, char_id, char_text, style_id } = run_board_cells
const { paint, unpair } = run_board_cells_ansi
const ESC = '\u{1B}'
const RED = `${ESC}[31m`
const RESET = `${ESC}[0m`
const SIZE = { rows: 3, columns: 4 }

// Each row's characters, a wide character's second cell left out.
function rows_of(cells: Cells): Array<string> {
	return Array.from({ length: cells.rows }, (_, row) =>
		[...cells.chars.subarray(row * cells.columns, (row + 1) * cells.columns)]
			.filter((char) => char !== CONTINUATION)
			.map((char) => char_text(char))
			.join(''),
	)
}

function painted(text: string): Cells {
	const cells = cells_of(SIZE)

	paint(cells, text)

	return cells
}

describe('run_board_cells_ansi.paint', () => {
	it('puts colored text on its cells with its style', () => {
		const cells = painted(`a${RED}b${RESET}c`)

		expect(rows_of(cells)[0]).toBe('abc ')
		expect([...cells.styles.subarray(0, 3)]).toStrictEqual([
			DEFAULT_STYLE,
			style_id(RED, ''),
			DEFAULT_STYLE,
		])
	})

	it('gives a run re-colored on every character one style, not a longer one each time', () => {
		const run = `${ESC}[39m${RED}`
		const cells = painted(`${RED}a${run}b${run}c${run}d`)

		expect(new Set(cells.styles.subarray(0, SIZE.columns))).toStrictEqual(
			new Set([style_id(RED, '')]),
		)
	})

	it('goes to the next row on a newline and wraps at the last column', () => {
		expect(rows_of(painted('ab\n12345'))).toStrictEqual(['ab  ', '1234', '5   '])
	})
})

describe('run_board_cells_ansi.paint — controls', () => {
	it('moves the cursor and erases to the line end', () => {
		const cells = painted(`wxyz${ESC}[1;2H${ESC}[K${ESC}[2;3Hq`)

		expect(rows_of(cells)).toStrictEqual(['w   ', '  q ', ' '.repeat(4)])
	})

	it('erases the whole screen', () => {
		expect(rows_of(painted(`ab\ncd${ESC}[2J`))).toStrictEqual([
			' '.repeat(4),
			' '.repeat(4),
			' '.repeat(4),
		])
	})

	it('takes two cells for a wide character', () => {
		const cells = painted('日a')

		expect(cells.chars[1]).toBe(CONTINUATION)
		expect(rows_of(cells)[0]).toBe('日a ')
	})

	it('styles cells with an OSC 8 hyperlink', () => {
		const cells = painted(`${ESC}]8;;https://example.com${ESC}\\x${ESC}]8;;${ESC}\\y`)

		expect(cells.styles[0]).toBe(style_id('', 'https://example.com'))
		expect(cells.styles[1]).toBe(DEFAULT_STYLE)
	})

	it('drops what falls past the last row', () => {
		expect(rows_of(painted('a\nb\nc\nd'))).toStrictEqual(['a   ', 'b   ', 'c   '])
	})
})

describe('run_board_cells_ansi.unpair', () => {
	it('blanks the other half of a wide character a cell overwrites', () => {
		const cells = painted('日')

		unpair(cells, 1)

		expect(cells.chars[0]).toBe(char_id(' '))
	})
})
