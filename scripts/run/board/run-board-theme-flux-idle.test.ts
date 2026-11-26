import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_idle } from './run-board-theme-flux-idle'

// joshuafolkken/kit#8917: the BTTF theme's rule gauge, shimmer and idle crackle.

const { crackle, idle_touches, rule_lit, shimmer, under_event_touches } = run_board_theme_flux_idle
const { CONTEXT, HOST, board_grid, moment_at } = run_board_theme_flux_fixture
const { edge } = HOST.layout

describe('run_board_theme_flux_idle', () => {
	it('lights the rules to the speed’s range, all of them at 88', () => {
		expect(rule_lit(CONTEXT, moment_at('i', 50).motion, 50)).toBe(Math.round((13 * edge) / 23))
		expect(rule_lit(CONTEXT, moment_at('n', 100).motion, 100)).toBe(edge)
	})

	it('crackles on the first three ticks of every thirty-five only', () => {
		const quiet = board_grid()

		crackle(CONTEXT, quiet, 3)

		expect(quiet).toStrictEqual(board_grid())
	})

	it('shimmers two rows a tick down the board', () => {
		const grid = board_grid()

		shimmer(CONTEXT, grid, 2)

		expect(grid.slice(0, 4)).toStrictEqual(board_grid().slice(0, 4))
		expect(grid.slice(4, 6)).not.toStrictEqual(board_grid().slice(4, 6))
	})

	it('lights the rules in every event, the shimmer kept off the NOTICE', () => {
		const grid = board_grid()

		under_event_touches(CONTEXT, grid, moment_at('n', 140 + 1))

		expect(CONTEXT.rule_rows).not.toContain(2)
		expect(grid.slice(2, 4)).toStrictEqual(board_grid().slice(2, 4))
		expect(grid).not.toStrictEqual(board_grid())
	})

	it('keeps idle’s crackle to a quiet board', () => {
		const grid = board_grid()

		idle_touches(CONTEXT, grid, moment_at('p', 20))

		expect(grid).toStrictEqual(board_grid())
	})
})
