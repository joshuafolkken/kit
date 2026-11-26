import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_place } from './run-board-theme-wopr-place'

const { HOST, WOPR } = run_board_theme_wopr_fixture
const { BOARD_W, positions_of } = run_board_theme_wopr_place

describe('run_board_theme_wopr_place', () => {
	it('centres ten LED characters in the 3-4-3 grouping', () => {
		const positions = positions_of(69)
		const steps = positions.slice(1).map((x, k) => x - (positions[k] ?? 0))

		expect(positions[0]).toBe(3)
		expect(steps).toStrictEqual([6, 6, 8, 6, 6, 6, 8, 6, 6])
	})

	it('puts the tic-tac-toe screen just left of DEFCON, its board inside it', () => {
		const { level_spot } = HOST.layout

		expect(WOPR.screen).toStrictEqual({ x0: level_spot.x - 26, x1: level_spot.x - 2 })
		expect(WOPR.window_w).toBe(WOPR.screen.x0 - 1)
		expect(WOPR.board_x + BOARD_W).toBeLessThanOrEqual(WOPR.screen.x1)
	})

	it('finds the rules’ dashes, none in DEFCON’s tail', () => {
		const { level_spot } = HOST.layout

		expect(WOPR.rule_cells.length).toBeGreaterThan(0)
		expect(WOPR.rule_cells.every(({ y, x }) => HOST.board[y]?.[x]?.[0] === '-')).toBe(true)
		expect(WOPR.rule_cells.some(({ y, x }) => y === level_spot.y && x >= level_spot.x - 1)).toBe(
			false,
		)
	})

	it('lays the map over the area’s rows under its rule, the coast within the land', () => {
		const land = new Set(WOPR.land_cells.map(({ y, x }) => `${String(y)},${String(x)}`))

		expect(WOPR.sky).toBe(HOST.layout.area_top + 1)
		expect(WOPR.coast_cells.every(({ y, x }) => land.has(`${String(y)},${String(x)}`))).toBe(true)
	})
})
