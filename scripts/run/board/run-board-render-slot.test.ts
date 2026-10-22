import { describe, expect, it } from 'vitest'
import { run_board_render_slot } from './run-board-render-slot'

// A column's cell is one width on every line it is drawn on.

const { cell_of } = run_board_render_slot

describe('run_board_render_slot.cell_of', () => {
	it('pads a row’s text with blanks to the column width', () => {
		expect(cell_of('💓 14:05', 9)).toBe('💓 14:05 ')
	})

	it('fills a row that draws nothing with blanks only', () => {
		expect(cell_of(undefined, 3)).toBe(' '.repeat(3))
	})

	it('never trims text wider than the column', () => {
		expect(cell_of('abcd', 2)).toBe('abcd')
	})
})
