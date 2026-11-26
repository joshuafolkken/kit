import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_ending } from './run-board-theme-magi-ending'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#8917: the MAGI theme's shutdown ending.

const { magi_ending, shutdown_look } = run_board_theme_magi_ending
const { HOST, KIT, fresh_grid, row_text, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_ending.shutdown_look', () => {
	it('runs on internal power, shuts down, then goes offline', () => {
		expect(shutdown_look(-1, 0).text).toBe('INTERNAL')
		expect(shutdown_look(0, 0).text).toBe('SHUTDOWN')
		expect(shutdown_look(8, 0).text).toBe('OFFLINE')
	})
})

describe('run_board_theme_magi_ending.magi_ending', () => {
	it('cuts the power and marks it on the level', () => {
		const grid = fresh_grid()

		magi_ending(KIT).draw(grid, 20, state_at('i', 20))

		expect(row_text(grid, HOST.layout.level_spot.y)).toContain('POWER CUT')
		expect(row_text(grid, 7)).toContain(' INTERNAL ')
	})

	it('ends on an empty screen', () => {
		const grid = fresh_grid()

		magi_ending(KIT).draw(grid, 90, state_at('i', 90))

		expect(grid.every((row) => row.every(([ch]) => ch === ' '))).toBe(true)
	})
})
