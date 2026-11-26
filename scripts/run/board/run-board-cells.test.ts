import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'

// joshuafolkken/kit#8826: a screen as cells — characters and style ids in typed arrays.

const { BLANK, DEFAULT_STYLE, UNSET, cells_of, char_id, char_text, copy, is_sized, put } =
	run_board_cells
const { style_id, style_of } = run_board_cells
const SIZE = { rows: 2, columns: 3 }

describe('run_board_cells.cells_of', () => {
	it('fills every cell blank in the default style', () => {
		const cells = cells_of(SIZE)

		expect(cells.chars).toHaveLength(SIZE.rows * SIZE.columns)
		expect([...cells.chars].every((char) => char === BLANK)).toBe(true)
		expect([...cells.styles].every((style) => style === DEFAULT_STYLE)).toBe(true)
	})

	it('fills every cell with the given fill', () => {
		expect([...cells_of(SIZE, UNSET).chars].every((char) => char === UNSET)).toBe(true)
	})
})

describe('run_board_cells.style_id', () => {
	it('gives the same id for the same style and another for another', () => {
		const red = style_id('\u{1B}[31m', '')

		expect(style_id('\u{1B}[31m', '')).toBe(red)
		expect(style_id('\u{1B}[31m', 'https://example.com')).not.toBe(red)
		expect(style_of(red)).toStrictEqual({ sgr: '\u{1B}[31m', link: '' })
	})

	it('gives the default id for no style', () => {
		expect(style_id('', '')).toBe(DEFAULT_STYLE)
	})
})

describe('run_board_cells.char_id', () => {
	it('round-trips one code point and a grapheme of several', () => {
		const flag = '👍🏽'

		expect(char_id('a')).toBe('a'.codePointAt(0))
		expect(char_text(char_id('a'))).toBe('a')
		expect(char_id(flag)).toBe(char_id(flag))
		expect(char_text(char_id(flag))).toBe(flag)
	})
})

describe('run_board_cells.is_sized', () => {
	it('is true only for cells of the same size', () => {
		expect(is_sized(cells_of(SIZE), SIZE)).toBe(true)
		expect(is_sized(cells_of(SIZE), { rows: 2, columns: 4 })).toBe(false)
		expect(is_sized(undefined, SIZE)).toBe(false)
	})
})

describe('run_board_cells.copy', () => {
	it('makes the target the same as the source', () => {
		const from = cells_of(SIZE)
		const to = cells_of(SIZE)

		put(from, 1, char_id('x'), style_id('\u{1B}[1m', ''))
		copy(from, to)

		expect(to).toStrictEqual(from)
	})
})
