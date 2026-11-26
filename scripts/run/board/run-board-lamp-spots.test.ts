import { describe, expect, it } from 'vitest'
import { run_board_lamp_spots } from './run-board-lamp-spots'
import { run_board_spin } from './run-board-spin'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8236: the lamp panel's cells on screen, which a themed board's theme layer lays its
// panel and area out by (joshuafolkken/kit#8917).

const { lamps_in } = run_board_lamp_spots
const { spun } = run_board_spin
const { LAMP, LAMP_MARK } = run_board_spot
const WIDE = { rows: 24, columns: 80 }
const PANEL = Array.from({ length: 8 }, () => LAMP).join(' ')
const LINES = ['header', `  24h  5  ${PANEL}`, `   7d     ${PANEL}`]

describe('run_board_lamp_spots.lamps_in', () => {
	it('records each lamp’s cell, its panel row and its group of four', () => {
		const lamps = lamps_in(LINES, [1, 2, 3], WIDE.columns)

		expect(lamps).toHaveLength(16)
		expect(lamps[0]).toMatchObject({ row: 2, column: 11, panel_row: 0, group: 0, lamp: 0 })
		expect(lamps[5]).toMatchObject({ row: 2, column: 21, group: 1, lamp: 1 })
		expect(lamps[8]).toMatchObject({ row: 3, column: 11, panel_row: 1, lamp: 0 })
	})

	it('draws each lamp out as `■`, the frame’s lines the same at every moment', () => {
		const first = spun(LINES, '⠋', { size: WIDE })
		const later = spun(LINES, '⠙', { size: WIDE })
		const marks = Array.from({ length: 8 }, () => LAMP_MARK).join(' ')

		expect(first.lines[1]).toBe(`  24h  5  ${marks}`)
		expect(later.lines).toStrictEqual(first.lines)
	})

	it('records the lamps the spin hands the theme layer, none past the screen', () => {
		expect(spun(LINES, '⠋', { size: WIDE }).lamps).toHaveLength(16)
		expect(spun(LINES, '⠋', { size: { rows: 2, columns: 80 } }).lamps).toHaveLength(8)
	})
})
