import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_idle } from './run-board-theme-wopr-idle'

const { HOST, WOPR, board_grid, cell_of, row_text, state_at } = run_board_theme_wopr_fixture
const { crack_row, draw_codes, draw_defcon, draw_lamps, draw_sweep, is_lit, progress_strip } =
	run_board_theme_wopr_idle

describe('run_board_theme_wopr_idle', () => {
	it('lights a lamp the same way for the same step', () => {
		expect(is_lit(800, 3, 1, false)).toBe(is_lit(820, 3, 1, false))
	})

	it('draws a lamp every other column from the lamp panel’s left', () => {
		const grid = board_grid()

		draw_lamps(WOPR, grid, state_at('i', 50), 50)

		expect(grid[WOPR.lamps.top]?.[WOPR.lamps.x]?.[0]).toBe('■')
	})

	it('runs the sweep a cell a tick', () => {
		const grid = board_grid()

		draw_sweep(WOPR, grid, 3)

		expect(row_text(grid, WOPR.sweep.y).indexOf('■')).toBe(WOPR.sweep.left + 3)
	})
})

describe('run_board_theme_wopr_idle — the rules, DEFCON and the lane', () => {
	it('writes DEFCON with the level bracketed', () => {
		const grid = board_grid()
		const { level_spot } = HOST.layout

		draw_defcon(WOPR, grid, state_at('r', 12), 12)

		expect(row_text(grid, level_spot.y).slice(level_spot.x - 1)).toContain('DEFCON 5 [4] 3 2 1')
	})

	it('runs launch code on the rules while a lane types', () => {
		const grid = board_grid()
		const [first = { y: 0, x: 0 }] = WOPR.rule_cells

		draw_codes(WOPR, grid, state_at('r', 12), 12)

		expect(cell_of(grid, first)[0]).not.toBe('-')
	})

	it('cracks the lane in white during ROW', () => {
		const grid = board_grid()
		const state = state_at('r', 14)
		const { row } = HOST.layout

		crack_row(WOPR, grid, state, 14)

		expect(cell_of(grid, { y: row.y, x: row.x + state.row.length - 1 })[1]).toContain('255;255;255')
	})

	it('locks CPE beside DEFCON as the now line ends', () => {
		const grid = board_grid()
		const state = state_at('p', 10 + state_at('p', 10).progress.total - 2)

		progress_strip(WOPR, grid, state, state.tick)

		expect(row_text(grid, HOST.layout.level_spot.y).slice(WOPR.strip_x, WOPR.strip_x + 3)).toMatch(
			/^CP./u,
		)
	})
})
