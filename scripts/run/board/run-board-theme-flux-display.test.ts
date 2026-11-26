import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_display } from './run-board-theme-flux-display'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'

// joshuafolkken/kit#8917: late in the JUMP's build the area becomes the destination and the speed.

const { big_display } = run_board_theme_flux_display
const { CONTEXT, HOST, board_grid, moment_at, row_text } = run_board_theme_flux_fixture
const { area_top } = HOST.layout
const REVEAL = 20

describe('run_board_theme_flux_display', () => {
	it('leaves the area alone with no jump coming', () => {
		const grid = board_grid()

		big_display(CONTEXT, grid, moment_at('i', 100))

		expect(grid).toStrictEqual(board_grid())
	})

	// Its first tick brings in 20 columns: half again the demo's 13 (the confirmed specification §4).
	it('comes in from the left, the rest of the area kept', () => {
		const grid = board_grid()
		const whole = board_grid()

		big_display(CONTEXT, grid, moment_at('n', 90 - 45))
		big_display(CONTEXT, whole, moment_at('n', 90 - 45 + 1))
		const row = row_text(grid, area_top)

		expect(row.slice(0, REVEAL)).toBe(row_text(whole, area_top).slice(0, REVEAL))
		expect(row.slice(REVEAL)).toBe(row_text(board_grid(), area_top).slice(REVEAL))
		expect(row.slice(REVEAL)).not.toBe(row_text(whole, area_top).slice(REVEAL))
	})

	it('takes the whole area to the panel at the jump', () => {
		const grid = board_grid()

		big_display(CONTEXT, grid, moment_at('n', 90))

		expect(row_text(grid, area_top)).toContain('-- -- DESTINATION TIME ---')
		expect(row_text(grid, area_top + 4)).toContain('-- -- SPEED ---')
		expect(row_text(grid, area_top + 6).slice(2, 5)).toBe('MPH')
	})
})
