import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render_quota } from './run-board-render-quota'

const { gauge_text } = run_board_render_quota
const CELL_WIDTH = 45
const HALF_BAR = '■■■■■■■■■■┊─────────'
// The bar ends at 4 + 1 + 20; two spaces, then the 11-wide reset column, two spaces, the count.
const RESET_COLUMN = 27
const COUNT_COLUMN = 40

function cell_of(reset: string, count: string): string {
	return stripVTControlCharacters(gauge_text(50, 0.5, reset, count))
}

function column_at(cell: string, value: string): number {
	return run_board_fit.width_of(cell.slice(0, cell.indexOf(value)))
}

describe('run_board_render_quota.gauge_text', () => {
	it('places the given reset and count verbatim in their columns', () => {
		const cell = cell_of('3721/5000', '≈12')

		expect(cell).toContain(HALF_BAR)
		expect(column_at(cell, '3721/5000')).toBe(RESET_COLUMN)
		expect(column_at(cell, '≈12')).toBe(COUNT_COLUMN)
		expect(run_board_fit.width_of(cell)).toBe(CELL_WIDTH)
	})

	it('keeps the cell width with an empty reset and count', () => {
		const cell = cell_of('', '')

		expect(cell.trimEnd().endsWith(HALF_BAR)).toBe(true)
		expect(run_board_fit.width_of(cell)).toBe(CELL_WIDTH)
	})

	it('keeps the count column put behind an empty reset', () => {
		const cell = cell_of('', '≈9')

		expect(column_at(cell, '≈9')).toBe(COUNT_COLUMN)
	})
})
