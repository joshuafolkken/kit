import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_alert } from './run-board-theme-magi-alert'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#8917: the MAGI theme's NOTICE effect.

const { band_direction, emergency_header, emergency_screen, warning_bands } =
	run_board_theme_magi_alert
const { HOST, KIT, fresh_grid, row_text, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_alert.band_direction', () => {
	it('marches neighboring gaps’ bands opposite ways', () => {
		expect([0, 1, 2].map((row) => band_direction(row))).toStrictEqual([-1, 1, -1])
	})
})

describe('run_board_theme_magi_alert idle', () => {
	it('draws nothing while no notice is active', () => {
		const grid = fresh_grid()
		const state = state_at('i', 40)

		emergency_screen(KIT, grid, state, 40)
		emergency_header(KIT, grid, state, 40)
		warning_bands(KIT, grid, state, 40)

		expect(grid).toStrictEqual(fresh_grid())
	})
})

describe('run_board_theme_magi_alert during a notice', () => {
	it('borrows the header for the order and PATTERN BLUE', () => {
		const grid = fresh_grid()

		emergency_header(KIT, grid, state_at('n', 30), 30)

		expect(row_text(grid, 1)).toContain('ALL HANDS · FIRST STAGE ALERT')
		expect(row_text(grid, 0)).toContain('PATTERN')
		expect(row_text(grid, 2)).toContain('UNIDENTIFIED')
	})

	it('types the report in beneath EMERGENCY', () => {
		const grid = fresh_grid()

		emergency_screen(KIT, grid, state_at('n', 200), 200)

		expect(row_text(grid, 9)).toContain('ALERT DECLARED')
		expect(row_text(grid, 11)).toContain('RED · ALL UNITS HOLD')
	})

	it('lays WARNING bands in every gap while the notice builds', () => {
		const grid = fresh_grid()

		warning_bands(KIT, grid, state_at('n', 30), 30)

		for (const y of HOST.layout.gap_rows) expect(row_text(grid, y)).toContain('WARNING')
	})
})
