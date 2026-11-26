import { describe, expect, it } from 'vitest'
import { run_board_spin_turn } from './run-board-spin-turn'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8794: what one wake between redraws writes, apart from when the wakes come.

const { colons_of, spin_bytes } = run_board_spin_turn
const ESCAPE = '\u{1B}'
const GREEN = `${ESCAPE}[32m`
const COLON = { row: 2, column: 3, style: '' }

describe('run_board_spin_turn.spin_bytes', () => {
	it('moves the cursor to each spot and draws the frame in its colors, then resets', () => {
		const spots = [
			{ row: 1, column: 1, style: GREEN },
			{ row: 4, column: 3, style: '' },
		]

		expect(spin_bytes(spots, '⠹')).toBe(
			`${ESCAPE}[1;1H${GREEN}⠹${ESCAPE}[0m${ESCAPE}[4;3H⠹${ESCAPE}[0m`,
		)
	})
})

describe('run_board_spin_turn.colons_of', () => {
	const typing = run_board_type_rows.NO_TYPING

	it('gives the colons the frame placed', () => {
		expect(colons_of({ spots: [], typing, colons: [COLON] })).toStrictEqual([COLON])
	})

	it('gives none where the frame placed none', () => {
		expect(colons_of({ spots: [], typing })).toStrictEqual([])
	})
})
