import { describe, expect, it } from 'vitest'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin_place } from './run-board-spin-place'
import { run_board_spot } from './run-board-spot'

const { SPOT, TICK } = run_board_spot
// The row key's end mark (`run-board-row-key.ts`), past which a row's suffix rides along.
const END = '\u{E008}'
const COLUMNS = 10
const SCREEN = { rows: 24, columns: COLUMNS }
// Wide enough for a sweep's 20 cells.
const WIDE = { rows: 24, columns: 80 }

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

	it('places a mark on the first row when its line has no recorded start', () => {
		const spots = run_board_spin_place.marks_in([`a${SPOT}`], SPOT, [], SCREEN)

		expect(spots).toStrictEqual([{ row: 1, column: 2, style: '' }])
	})
})

describe('run_board_spin_place.keyed_of', () => {
	it('keeps a line with no key as written and keys nothing', () => {
		const keyed = run_board_spin_place.keyed_of(['plain'], '|', [1])

		expect(keyed).toStrictEqual({ lines: ['plain'], keyed: [] })
	})

	it('keys a row on its start row and takes the key out of the line', () => {
		const keyed = run_board_spin_place.keyed_of(
			[run_board_row_key.keyed('done', 7, 'abc')],
			'|',
			[3],
		)

		expect(keyed).toStrictEqual({
			lines: ['abc'],
			keyed: [{ key: 'done:7', index: 0, row: 3, text: 'abc', prefix_columns: 0 }],
		})
	})

	it('keys a row on the first row when it has no recorded start, its suffix riding along', () => {
		const line = `${run_board_row_key.keyed('done', 7, 'abc')}${END}PANEL`
		const keyed = run_board_spin_place.keyed_of([line], '|', [])

		expect(keyed).toStrictEqual({
			lines: ['abcPANEL'],
			keyed: [{ key: 'done:7', index: 0, row: 1, text: 'abc', prefix_columns: 0, suffix: 'PANEL' }],
		})
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

	it('does not type a row its suffix wraps', () => {
		const suffixed = { ...line, suffix: 'x'.repeat(COLUMNS) }

		expect(run_board_spin_place.can_type(suffixed, SCREEN.rows, COLUMNS)).toBe(false)
	})
})

describe('run_board_spin_place.sweep_in', () => {
	it('has no sweep without a tick placeholder', () => {
		expect(run_board_spin_place.sweep_in(['plain'], [1], SCREEN)).toBeUndefined()
	})

	it('sweeps the empty line below the tick', () => {
		expect(run_board_spin_place.sweep_in([`12${TICK}`, ''], [1, 2], WIDE)).toStrictEqual({
			row: 2,
			left: 1,
		})
	})

	it('has no sweep when the lines have no recorded starts', () => {
		expect(run_board_spin_place.sweep_in([`12${TICK}`, ''], [], WIDE)).toBeUndefined()
	})
})
