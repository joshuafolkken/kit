import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render_quota_cell, type Cell } from './run-board-render-quota-cell'

const { cell_text, row_text } = run_board_render_quota_cell
const CELL_WIDTH = 46
const HALF_BAR = '■■■■■■■■■■┊─────────'
const CELL: Cell = { label: '7d', used_percent: 50, pace: 0.5, count: '≈412', reset: 'Sat 10:00' }

function plain_of(cell: Partial<Cell>): string {
	return stripVTControlCharacters(cell_text({ ...CELL, ...cell }))
}

describe('run_board_render_quota_cell.cell_text', () => {
	it('draws the label, percent, bar, count and reset time in that order, without ↻', () => {
		expect(plain_of({})).toBe(`   7d  50% ${HALF_BAR} ≈412 Sat 10:00`)
	})

	it('right-aligns the label, the count and the reset time in their columns', () => {
		const cell = plain_of({ label: 'rest', count: '≈52', reset: '13:59' })

		expect(cell).toBe(` rest  50% ${HALF_BAR}  ≈52     13:59`)
		expect(run_board_fit.width_of(cell)).toBe(CELL_WIDTH)
	})

	it('fits ▶ in the label column, ending a marked label where an unmarked one ends', () => {
		expect(plain_of({ label: '▶rest' })).toBe(`▶rest  50% ${HALF_BAR} ≈412 Sat 10:00`)
	})

	it('keeps the count and reset columns blank where neither is told', () => {
		const cell = plain_of({ count: '', reset: '' })

		expect(cell).toBe(`   7d  50% ${HALF_BAR}${' '.repeat(15)}`)
		expect(run_board_fit.width_of(cell)).toBe(CELL_WIDTH)
	})

	it('pushes the rest of the cell right by what a wide label or count overflows', () => {
		const cell = plain_of({ label: '▶graphql', count: '15000' })

		expect(cell).toMatch(/^▶graphql {2}50% \S{20} 15000 Sat 10:00$/u)
	})
})

describe('run_board_render_quota_cell.row_text', () => {
	it('sets the cells two spaces apart and drops the trailing blank of an empty reset', () => {
		const row = stripVTControlCharacters(row_text([CELL, { ...CELL, label: 'graphql', reset: '' }]))

		expect(row).toBe(`   7d  50% ${HALF_BAR} ≈412 Sat 10:00  graphql  50% ${HALF_BAR} ≈412`)
	})
})
