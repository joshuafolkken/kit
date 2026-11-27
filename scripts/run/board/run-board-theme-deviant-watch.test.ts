import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_deviant_watch } from './run-board-theme-deviant-watch'

// joshuafolkken/kit#9096: the deviant theme's idle reticle that closes on one of the board's numbers.

const { gap_at, open_rows, row_limit, target_of, turn_at, watch } = run_board_theme_deviant_watch
const { HOST, draw_at, fresh_grid, row_text } = run_board_theme_deviant_fixture
const { area_top, edge, px } = HOST.layout
const SCAN_EVERY = 160
// A tick the first reticle holds on its number, and the number it closes on.
const HOLDING = 15
const TARGET = { y: 42, x: 92, end: 96 }

describe('run_board_theme_deviant_watch.gap_at', () => {
	it('closes from six cells out to one', () => {
		expect([0, 5, 10, 30].map((age) => gap_at(age))).toStrictEqual([6, 4, 1, 1])
	})
})

describe('run_board_theme_deviant_watch.turn_at', () => {
	it('starts a reticle every three seconds from the scan band’s pass', () => {
		expect(turn_at(0)).toStrictEqual({ cycle: 0, age: 0 })
		expect(turn_at(65)).toStrictEqual({ cycle: 1, age: 5 })
		expect(turn_at(SCAN_EVERY + 5)).toStrictEqual({ cycle: SCAN_EVERY, age: 5 })
	})

	it('is gone once it has let go, and waits out the scan band', () => {
		expect(turn_at(40)).toBeUndefined()
		expect(turn_at(125)).toBeUndefined()
	})
})

describe('run_board_theme_deviant_watch.row_limit', () => {
	it('ends the data before the panel beside the area, at the edge elsewhere', () => {
		expect([row_limit(HOST.layout, area_top + 1), row_limit(HOST.layout, 0)]).toStrictEqual([
			px - 1,
			edge,
		])
	})
})

describe('run_board_theme_deviant_watch.open_rows', () => {
	it('leaves out the header and the rules', () => {
		const rows = open_rows(draw_at('i', 0))

		expect(rows.slice(0, 4)).toStrictEqual([3, 5, 6, 7])
		expect(rows).not.toContain(area_top)
	})
})

describe('run_board_theme_deviant_watch.target_of', () => {
	it('picks a number standing alone on a row of data', () => {
		expect(target_of(draw_at('i', 0), 0)).toStrictEqual(TARGET)
	})
})

describe('run_board_theme_deviant_watch.watch', () => {
	it('brackets the number and locks it while it holds', () => {
		const draw = draw_at('i', HOLDING)

		watch(draw)

		const row = row_text(draw.grid, TARGET.y)

		expect(row.charAt(TARGET.x - 1)).toBe('⌜')
		expect(row.charAt(TARGET.end)).toBe('⌟')
		expect(draw.grid[TARGET.y]?.[TARGET.x]).not.toStrictEqual(HOST.board[TARGET.y]?.[TARGET.x])
	})

	it('draws nothing between reticles', () => {
		const draw = draw_at('i', 40)

		watch(draw)
		expect(draw.grid).toStrictEqual(fresh_grid())
	})
})
