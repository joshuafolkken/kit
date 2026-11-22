import { describe, expect, it } from 'vitest'
import { run_board_spin_place } from './run-board-spin-place'
import { run_board_spot } from './run-board-spot'

const { SPOT } = run_board_spot
const COLUMNS = 10
const SCREEN = { rows: 24, columns: COLUMNS }

describe('run_board_spin_place.starts_of', () => {
	it('starts each line below the rows the lines above it wrap to', () => {
		const lines = ['short', 'x'.repeat(COLUMNS * 2), 'tail']

		expect(run_board_spin_place.starts_of(lines, COLUMNS)).toStrictEqual([1, 2, 4])
	})
})

describe('run_board_spin_place.marks_in', () => {
	it('places each mark on its line row, skipping rows past the screen', () => {
		const lines = [`a${SPOT}`, `b${SPOT}`]
		const spots = run_board_spin_place.marks_in(lines, SPOT, [1, 2], { rows: 1, columns: COLUMNS })

		expect(spots.map((spot) => spot.row)).toStrictEqual([1])
	})
})

describe('run_board_spin_place.keyed_of', () => {
	it('keeps a line with no key as written and keys nothing', () => {
		const keyed = run_board_spin_place.keyed_of(['plain'], '|', [1])

		expect(keyed).toStrictEqual({ lines: ['plain'], keyed: [] })
	})
})

describe('run_board_spin_place.can_type', () => {
	const line = { key: 'k', index: 0, row: 1, text: 'abc', prefix_columns: 0 }

	it('types a row on screen that fits one screen row', () => {
		expect(run_board_spin_place.can_type(line, SCREEN.rows, COLUMNS)).toBe(true)
	})

	it('does not type a row past the screen', () => {
		expect(run_board_spin_place.can_type({ ...line, row: 2 }, 1, COLUMNS)).toBe(false)
	})

	it('does not type a row that wraps', () => {
		const wide = { ...line, text: 'x'.repeat(COLUMNS + 1) }

		expect(run_board_spin_place.can_type(wide, SCREEN.rows, COLUMNS)).toBe(false)
	})
})

describe('run_board_spin_place.sweep_in', () => {
	it('has no sweep without a tick placeholder', () => {
		expect(run_board_spin_place.sweep_in(['plain'], [1], SCREEN)).toBeUndefined()
	})
})
