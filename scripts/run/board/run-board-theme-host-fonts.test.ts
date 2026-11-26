import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the theme host's three-row letters and digits, as the confirmed demo's.

const { banner, big_digit, big_number, big_width } = run_board_theme_host_fonts
const { row_of } = run_board_theme_host_grid

function blank_grid(rows: number, width: number): Grid {
	return Array.from({ length: rows }, () => row_of('', 'body', width))
}

function text_of(grid: Grid): Array<string> {
	return grid.map((row) => row.map(([ch]) => ch).join(''))
}

describe('run_board_theme_host_fonts.big_width', () => {
	it('counts four cells a digit and two a point, less the last gap', () => {
		expect(big_width('8')).toBe(3)
		expect(big_width('1.5')).toBe(9)
		expect(big_width('140.85')).toBe(21)
	})
})

describe('run_board_theme_host_fonts.banner', () => {
	it('centres the three rows of its letters in the area, from its top row', () => {
		const grid = blank_grid(4, 11)

		banner(grid, { x: 0, w: 11, top: 1 }, 'A!', 'red')

		expect(text_of(grid)).toStrictEqual([
			' '.repeat(11),
			'   ▄▀▄ █   ',
			'   █▀█ █   ',
			'   ▀ ▀ ▄   ',
		])
		expect(grid[1]?.[3]).toStrictEqual(['▄', 'red'])
	})
})

describe('run_board_theme_host_fonts.big_digit', () => {
	it('lays the unlit segments in the ghost style, then the digit’s own over them', () => {
		const grid = blank_grid(3, 3)

		big_digit(grid, { y: 0, x: 0 }, '1', { style: 'hi', ghost: 'rule' })

		expect(text_of(grid)).toStrictEqual(['┏━╻', '┣━┃', '┗━╹'])
		expect(grid[0]?.map(([, style]) => style)).toStrictEqual(['rule', 'rule', 'hi'])
	})

	it('leaves the cells under a digit’s blanks alone without a ghost', () => {
		const grid = blank_grid(3, 3)

		big_digit(grid, { y: 0, x: 0 }, '7', { style: 'hi' })

		expect(text_of(grid)).toStrictEqual(['╺━┓', '  ┃', '  ╹'])
	})
})

describe('run_board_theme_host_fonts.big_number', () => {
	it('steps four cells a digit and two a point', () => {
		const grid = blank_grid(3, 9)

		big_number(grid, { y: 0, x: 0 }, '1.5', { style: 'hi' })

		expect(text_of(grid)).toStrictEqual(['  ╻   ┏━╸', '  ┃   ┗━┓', '  ╹ ● ╺━┛'])
	})
})
