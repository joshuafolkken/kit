import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_gauge } from './run-board-theme-flux-gauge'

// joshuafolkken/kit#8917: the BTTF theme's lamp gauge steps with the speed and springs past a change.

const { TOP_RANGE, bars_at, change_before, gauge_cells, range_of, sprung } =
	run_board_theme_flux_gauge

// The range 0 until tick 10, then 2.
function range_at(tick: number): number {
	return tick >= 10 ? 2 : 0
}

describe('run_board_theme_flux_gauge', () => {
	it('puts a speed in its range, 88 in the top one', () => {
		expect(range_of(28)).toBe(0)
		expect(range_of(45)).toBe(1)
		expect(range_of(87.4)).toBe(3)
		expect(range_of(88)).toBe(TOP_RANGE)
	})

	it('finds the last change of range within the ticks it looks back', () => {
		expect(change_before(12, range_at, 6)).toStrictEqual({ before: 0, since: 2 })
		expect(change_before(30, range_at, 6)).toBeUndefined()
	})

	it('springs past the new height, kept to the rows', () => {
		expect(sprung(10, 5, 1, 16)).toBe(12)
		expect(sprung(5, 10, 1, 16)).toBe(3)
		expect(sprung(15, 10, 1, 16)).toBe(16)
		expect(sprung(10, 5, undefined, 16)).toBe(10)
	})

	it('lights the red lamps only at the top, held still', () => {
		const still = { range: TOP_RANGE, change: undefined, climb: undefined, is_blink: false }

		expect(bars_at(still).filter((bars) => bars.is_red)).toHaveLength(9)
		expect(bars_at({ ...still, range: 0 }).some((bars) => bars.is_red)).toBe(false)
	})

	it('draws ten columns of seven braille cells', () => {
		const cells = gauge_cells({ row: 5, column: 100 }, 3, () => 0, {})

		expect(cells).toHaveLength(70)
		expect(cells[0]).toMatchObject({ row: 5, column: 100 })
	})
})
