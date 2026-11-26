import { describe, expect, it } from 'vitest'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the theme host's drawing helpers, as the confirmed theme demo draws.

const { block, blank_row, cell_at, centered, code_points, digit, dimmed, framed } =
	run_board_theme_host_grid
const { cells_bar, repeated, rows_to } = run_board_theme_host_grid
const { in_capitals, is_rule, mixed, pick, put, rect_frame, restyle, row_of, set_cell, tear } =
	run_board_theme_host_grid

function grid_of(...lines: Array<string>): Grid {
	return lines.map((line) => row_of(line, 'body', code_points(line).length))
}

function text_of(grid: Grid): Array<string> {
	return grid.map((row) => row.map(([ch]) => ch).join(''))
}

describe('run_board_theme_host_grid.put', () => {
	it('writes each code point from `at` in the style given', () => {
		const grid = grid_of('......')

		put(grid, { y: 0, x: 1 }, 'a😀b', 'hi')

		expect(text_of(grid)).toStrictEqual(['.a😀b..'])
		expect(grid[0]?.slice(1, 4).map(([, style]) => style)).toStrictEqual(['hi', 'hi', 'hi'])
	})

	it('keeps each cell’s own style when no style is given', () => {
		const grid: Grid = [
			[
				['.', 'rule'],
				['.', 'ok'],
			],
		]

		put(grid, { y: 0, x: 0 }, 'ab')

		expect(grid).toStrictEqual([
			[
				['a', 'rule'],
				['b', 'ok'],
			],
		])
	})

	it('drops what falls off the row on either side, and a row that is not there', () => {
		const grid = grid_of('....')

		put(grid, { y: 0, x: -2 }, 'abc', 'hi')
		put(grid, { y: 0, x: 3 }, 'xyz', 'hi')
		put(grid, { y: 5, x: 0 }, 'gone', 'hi')

		expect(text_of(grid)).toStrictEqual(['c..x'])
		expect(grid[0]).toHaveLength(4)
	})
})

describe('run_board_theme_host_grid.restyle', () => {
	it('restyles the cells the test picks, with the style for their place', () => {
		const grid = grid_of('ab', 'cd')

		restyle(
			grid,
			(_, x, y) => x === y,
			(x, y, [ch]) => `${ch}${x}${y}`,
		)

		expect(grid.map((row) => row.map(([, style]) => style))).toStrictEqual([
			['a00', 'body'],
			['body', 'd11'],
		])
	})
})

describe('run_board_theme_host_grid small helpers', () => {
	it('picks from a list by a share of its length', () => {
		expect(pick(['a', 'b', 'c'], 0)).toBe('a')
		expect(pick('abc', 0.5)).toBe('b')
		expect(pick('abc', 0.99)).toBe('c')
	})

	it('makes a digit of a share and centres text in a width', () => {
		expect(digit(0.37)).toBe('3')
		expect(centered('ab', 6)).toBe('  ab  ')
		expect(centered('abc', 6)).toBe(' abc  ')
	})

	it('mixes two colors channel by channel, rounding each the share of the way', () => {
		expect(mixed('0;0;0', '255;100;10', 0.5)).toBe('128;50;5')
		expect(mixed('25;10;3', '150;60;15', 0)).toBe('25;10;3')
	})

	it('tells a rule cell by its role', () => {
		expect(is_rule(['-', 'rule:dim'])).toBe(true)
		expect(is_rule(['-', 'body'])).toBe(false)
	})

	it('reads a cell off the grid, blank off it, and sets one on a row that is there', () => {
		const grid = grid_of('ab')

		set_cell(grid, { y: 0, x: 1 }, ['z', 'hi'])
		set_cell(grid, { y: 3, x: 0 }, ['z', 'hi'])

		expect(cell_at(grid, 0, 1)).toStrictEqual(['z', 'hi'])
		expect(cell_at(grid, 4, 4)).toStrictEqual([' ', 'body'])
		expect(grid).toHaveLength(1)
	})
})

describe('run_board_theme_host_grid.tear', () => {
	it('slips a row right or left, its edge cells repeating', () => {
		const grid = grid_of('1234', '1234')

		tear(grid, 0, 1)
		tear(grid, 1, -2)

		expect(text_of(grid)).toStrictEqual(['1123', '3444'])
	})
})

describe('run_board_theme_host_grid whole-grid helpers', () => {
	it('raises every letter that stays one character', () => {
		const grid = grid_of('aß-z')

		in_capitals(grid)

		expect(text_of(grid)).toStrictEqual(['Aß-Z'])
	})

	it('dims every cell with a character on it', () => {
		const grid = grid_of('a b')

		dimmed(grid, 'rule')

		expect(grid[0]?.map(([, style]) => style)).toStrictEqual(['rule', 'body', 'rule'])
	})

	it('blanks a row to a width and a header block in one style', () => {
		const grid = grid_of('abcd', 'abcd', 'abcd', 'abcd')

		blank_row(grid, 3, 2)
		block(grid, { x: 1, w: 2 }, 'red')

		const blocked = 'a  d'

		expect(text_of(grid)).toStrictEqual([blocked, blocked, blocked, '  '])
		expect(grid[0]?.[1]).toStrictEqual([' ', 'red'])
	})
})

describe('run_board_theme_host_grid boxes', () => {
	it('frames a box with its label in the top rule', () => {
		const dots = '.'.repeat(10)
		const grid = grid_of(dots, dots, dots)

		framed(grid, { x: 1, y: 0, w: 8, h: 3 }, 'AB', 'ok')

		expect(text_of(grid)).toStrictEqual(['.┌─ AB ─┐.', '.│      │.', '.└──────┘.'])
	})

	it('draws a rectangle’s outline from corner to corner', () => {
		const dots = '.'.repeat(5)
		const grid = grid_of(dots, dots, dots)

		rect_frame(grid, { x0: 0, y0: 0, x1: 3, y1: 2 }, 'ok')

		expect(text_of(grid)).toStrictEqual(['┌──┐.', '│..│.', '└──┘.'])
	})
})

// joshuafolkken/kit#8917: a width worked out from a narrow board's layout never throws.
describe('run_board_theme_host_grid counts held at 0', () => {
	it('repeats a text, none for a count below 0', () => {
		expect(repeated('ab', 2)).toBe('abab')
		expect(repeated('ab', -3)).toBe('')
	})

	it('fills a bar of cells, its lit count held to the bar', () => {
		expect(cells_bar(2, 4)).toBe('▮▮▯▯')
		expect(cells_bar(6, 4)).toBe('▮▮▮▮')
		expect(cells_bar(-1, 3)).toBe('▯▯▯')
		expect(cells_bar(2, -5)).toBe('')
	})

	it('frames a box too narrow for its label without throwing', () => {
		const grid = grid_of('....')

		framed(grid, { x: 0, y: 0, w: 4, h: 1 }, 'LONG', 'ok')

		expect(text_of(grid)).toStrictEqual(['└──┘'])
	})

	it('cuts writes at the last row it keeps', () => {
		const grid = grid_of('...', '...')

		put(rows_to(grid, 0), { y: 1, x: 0 }, 'x')
		put(rows_to(grid, 0), { y: 0, x: 0 }, 'y')

		expect(text_of(grid)).toStrictEqual(['y..', '...'])
	})
})
