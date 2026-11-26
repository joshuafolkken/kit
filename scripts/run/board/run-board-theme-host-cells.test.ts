import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_theme_host_cells } from './run-board-theme-host-cells'
import type { FinalGrid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: a theme host frame as kit's screen cells.

const { cells_of_frame } = run_board_theme_host_cells
const { BLANK, DEFAULT_STYLE, char_text, style_of } = run_board_cells
const BOLD = '\u{1B}[1m'
const FRAME: FinalGrid = [
	[
		['a', BOLD, ''],
		['b', BOLD, '1;2;3'],
	],
	[['😀', BOLD, '1;2;3']],
]

describe('run_board_theme_host_cells.cells_of_frame', () => {
	const frame = FRAME
	const cells = cells_of_frame(frame, { rows: 3, columns: 3 })

	it('carries each cell’s character', () => {
		expect(Array.from(cells.chars.slice(0, 4), (id) => char_text(id))).toStrictEqual([
			'a',
			'b',
			' ',
			'😀',
		])
	})

	it('writes the painted style and then the wash as the cell’s SGR', () => {
		expect(style_of(cells.styles[0] ?? DEFAULT_STYLE).sgr).toBe(BOLD)
		expect(style_of(cells.styles[1] ?? DEFAULT_STYLE)).toStrictEqual({
			sgr: `${BOLD}\u{1B}[48;2;1;2;3m`,
			link: '',
		})
		expect(cells.styles[3]).toBe(cells.styles[1])
	})

	it('tells cells apart that differ in their wash alone', () => {
		expect(cells.styles[0]).not.toBe(cells.styles[1])
	})

	it('leaves cells outside the frame blank in the default style', () => {
		expect(cells.chars.slice(6)).toStrictEqual(new Uint32Array([BLANK, BLANK, BLANK]))
		expect(cells.styles.slice(6)).toStrictEqual(new Uint16Array(3).fill(DEFAULT_STYLE))
	})

	it('drops what lies past the size', () => {
		const small = cells_of_frame(frame, { rows: 1, columns: 1 })

		expect(Array.from(small.chars, (id) => char_text(id))).toStrictEqual(['a'])
	})
})
