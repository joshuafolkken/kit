import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'
import { run_board_theme_magi_gauges } from './run-board-theme-magi-gauges'

// joshuafolkken/kit#8917: the MAGI theme's level, clock and sync rate.

const { activity_limit, consensus, status, sync_rate } = run_board_theme_magi_gauges
const { HOST, KIT, fresh_grid, row_text, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_gauges.sync_rate', () => {
	it('has no rate while no lane syncs', () => {
		expect(sync_rate(state_at('i', 40), 40)).toBeUndefined()
	})

	it('reaches full once the lane has typed', () => {
		expect(sync_rate(state_at('r', 200), 200)).toBe(100)
	})
})

describe('run_board_theme_magi_gauges.consensus', () => {
	it('shows CONDITION GREEN idle and CONDITION RED during a notice', () => {
		const idle = fresh_grid()
		const red = fresh_grid()

		consensus(KIT, idle, state_at('i', 40), 40)
		consensus(KIT, red, state_at('n', 30), 30)

		expect(row_text(idle, HOST.layout.level_spot.y)).toContain('CONDITION GREEN')
		expect(row_text(red, HOST.layout.level_spot.y)).toContain('CONDITION RED')
	})

	it('deliberates while the progress line types, then gives the result', () => {
		const typing = fresh_grid()
		const result = fresh_grid()

		consensus(KIT, typing, state_at('p', 12), 12)
		consensus(KIT, result, state_at('p', 100), 100)

		expect(row_text(typing, HOST.layout.level_spot.y)).toContain('MAGI DELIBERATING')
		expect(row_text(result, HOST.layout.level_spot.y)).toContain('RESULT 2/3 PASSED')
	})
})

describe('run_board_theme_magi_gauges.activity_limit and status', () => {
	it('stops the clock idle and shows an empty sync rate', () => {
		const grid = fresh_grid()

		activity_limit(KIT, grid, state_at('i', 40), 40)
		status(KIT, grid, state_at('i', 40), 40)

		expect(row_text(grid, 6)).toContain('--:--:--')
		expect(row_text(grid, 6)).toContain('--.-%')
		expect(row_text(grid, 7)).toContain(' EXTERNAL ')
	})

	it('runs on internal power while anything types', () => {
		const grid = fresh_grid()

		activity_limit(KIT, grid, state_at('r', 30), 30)

		expect(row_text(grid, 7)).toContain(' INTERNAL ')
		expect(row_text(grid, 6)).toMatch(/00:\d\d:\d\d/u)
	})
})
