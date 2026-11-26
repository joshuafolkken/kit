import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_face_cells } from './run-board-theme-codec-face-cells'
import { run_board_theme_codec_face_fit } from './run-board-theme-codec-face-fit'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: each portrait cell's 2 by 4 sub-pixels fitted to a glyph and two greens.

const { GLYPHS, bust_portrait, fitted, lively } = run_board_theme_codec_face_fit
const { BUST } = run_board_theme_codec_face_cells
const SUB_PIXELS = 8
const LOOK = { is_open: false, is_blink: false, is_talking: false, tick: 0 }

function blank_grid(rows: number, columns: number): Grid {
	return Array.from({ length: rows }, () => Array.from({ length: columns }, () => [' ', '']))
}

describe('run_board_theme_codec_face_fit.fitted', () => {
	it('offers the fourteen quadrant shapes and the lower quarter and three quarters', () => {
		expect(GLYPHS).toHaveLength(16)
		expect(GLYPHS.every(({ covers }) => covers.length === SUB_PIXELS)).toBe(true)
	})

	it('fits an upper half lit over a dark lower half exactly with ▀', () => {
		const values = [1, 1, 1, 1, 0, 0, 0, 0]

		expect(fitted(values)).toStrictEqual({ error: 0, glyph: '▀', on: 1, off: 0 })
	})

	it('fits a lit bottom row with ▂', () => {
		expect(fitted([0, 0, 0, 0, 0, 0, 1, 1])).toMatchObject({ error: 0, glyph: '▂' })
	})
})

describe('run_board_theme_codec_face_fit portraits', () => {
	it('leaves a silent portrait’s image as it is, a talking one changed', () => {
		const image = [
			[0.5, 0.5],
			[0.5, 0.5],
		]

		expect(lively(image, LOOK)).toBe(image)
		expect(lively(image, { ...LOOK, is_talking: true, tick: 1 })).not.toStrictEqual(image)
	})

	it('writes the bust’s cells at its top left and nothing outside them', () => {
		const grid = blank_grid(BUST.rows + 2, BUST.columns + 2)

		bust_portrait(grid, { y: 1, x: 1 }, 'commander', LOOK)
		const styled = grid.flatMap((row, y) =>
			row.map(([, style], x) => ({ y, x, style })).filter(({ style }) => style !== ''),
		)

		expect(styled).toHaveLength(BUST.rows * BUST.columns)
		expect(
			styled.every(({ y, x }) => y >= 1 && y <= BUST.rows && x >= 1 && x <= BUST.columns),
		).toBe(true)
	})
})
