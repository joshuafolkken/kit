import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_theme_canvas } from './run-board-theme-canvas'
import type { FinalCell } from './run-board-theme-host-types'

const { put_frame } = run_board_theme_canvas
const PAINT = '\u{1B}[38;2;1;2;3m'
const LINK = 'https://example.com'

function cell(ch: string): FinalCell {
	return [ch, PAINT, '']
}

function canvas_of(text: string, columns = 4): ReturnType<typeof run_board_cells.cells_of> {
	const cells = run_board_cells.cells_of({ rows: 1, columns })

	run_board_cells_ansi.paint(cells, text)

	return cells
}

function chars_of(cells: ReturnType<typeof canvas_of>): Array<string> {
	return [...cells.chars].map((char) => run_board_cells.char_text(char))
}

describe('run_board_theme_canvas.put_frame', () => {
	it('puts each frame cell in its painted style, nothing past the canvas', () => {
		const cells = canvas_of('abcd', 2)

		put_frame(cells, [[cell('x'), cell('y'), cell('z')], [cell('w')]])

		expect(chars_of(cells)).toEqual(['x', 'y'])
		expect(run_board_cells.style_of(cells.styles[0] ?? 0).sgr).toBe(PAINT)
	})

	it('keeps a link where the theme left the character', () => {
		const cells = canvas_of(`\u{1B}]8;;${LINK}\u{1B}\\ab\u{1B}]8;;\u{1B}\\`)

		put_frame(cells, [[cell('a'), cell('x')]])

		expect(run_board_cells.style_of(cells.styles[0] ?? 0).link).toBe(LINK)
		expect(run_board_cells.style_of(cells.styles[1] ?? 0).link).toBe('')
	})

	it('keeps a wide character whole, and blanks one the theme split', () => {
		const kept = canvas_of('🔊x')
		const split = canvas_of('🔊x')

		put_frame(kept, [[cell('🔊'), cell(''), cell('x')]])
		put_frame(split, [[cell('🔊'), cell('-'), cell('x')]])

		expect(kept.chars[1]).toBe(run_board_cells.CONTINUATION)
		expect(chars_of(split).slice(0, 2)).toEqual([' ', '-'])
	})

	it('blanks a wide character second half the theme left alone after taking its first', () => {
		const cells = canvas_of('🔊x')

		put_frame(cells, [[cell('-'), cell(''), cell('x')]])

		expect(chars_of(cells).slice(0, 2)).toEqual(['-', ' '])
	})
})
