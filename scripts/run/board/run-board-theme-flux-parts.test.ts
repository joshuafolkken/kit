import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_parts } from './run-board-theme-flux-parts'

// joshuafolkken/kit#8917: the BTTF opening (the keypad line, the arrival) and ending (the departure).

const { ARRIVE_AT, DEPART_RUN, ending_of, opening_of } = run_board_theme_flux_parts
const { CONTEXT, board_grid, row_text, state_at } = run_board_theme_flux_fixture
const STATE = state_at('i', 0)

describe('run_board_theme_flux_parts', () => {
	it('types the keypad line on an empty screen, then holds it', () => {
		const typing = board_grid()
		const held = board_grid()

		opening_of(CONTEXT).draw(typing, 5, STATE)
		opening_of(CONTEXT).draw(held, ARRIVE_AT - 1, STATE)

		expect(row_text(typing, 0).trimEnd()).toBe('Roads?█')
		expect(row_text(held, 0).trimEnd()).toBe("Roads? Where we're going, we don't need roads.")
		expect(row_text(held, 1).trim()).toBe('')
	})

	it('flashes the board in, black between the flashes', () => {
		const dark = board_grid()
		const lit = board_grid()

		opening_of(CONTEXT).draw(dark, ARRIVE_AT, STATE)
		opening_of(CONTEXT).draw(lit, ARRIVE_AT + 16, STATE)

		expect(row_text(dark, 1).trim()).toBe('')
		expect(row_text(lit, 1)).toBe(row_text(board_grid(), 1))
	})

	it('ends on an empty screen after the departure', () => {
		const ending = ending_of(CONTEXT)
		const gone = board_grid()

		ending.draw(gone, ending.ticks - 1, STATE)

		expect(gone.every((row) => row.every(([ch]) => ch === ' '))).toBe(true)
		expect(DEPART_RUN).toBe(30)
	})
})
