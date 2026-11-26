import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_run } from './run-board-theme-flux-run'

// joshuafolkken/kit#8917: the run up to the BTTF JUMP — the lane whitens, arcs and bolts crackle.

const { bolts_born, draw_arcs, draw_bolts, lane_of, whiten_lane } = run_board_theme_flux_run
const { CONTEXT, HOST, board_grid, state_at } = run_board_theme_flux_fixture

describe('run_board_theme_flux_run', () => {
	it('throws more bolts as the run climbs, none outside it', () => {
		expect(bolts_born(-81, 80)).toBe(0)
		expect(bolts_born(0, 80)).toBe(0)
		expect(bolts_born(-80, 80)).toBe(0)
		expect(bolts_born(-1, 80)).toBe(Math.round(27 * (0.4 + (14 / 15) * 0.6)))
	})

	it('finds the lane of the notice’s issue', () => {
		const y = lane_of(CONTEXT, state_at('n', 50))

		expect(y === undefined || HOST.layout.lane_rows.includes(y)).toBe(true)
		expect(lane_of(CONTEXT, state_at('i', 50))).toBeUndefined()
	})

	it('whitens a lane, and no row when there is none', () => {
		const grid = board_grid()
		const y = HOST.layout.lane_rows[0] ?? 0

		whiten_lane(CONTEXT, grid, undefined, 1)
		expect(grid).toStrictEqual(board_grid())
		whiten_lane(CONTEXT, grid, y, 1)
		expect(grid[y]).not.toStrictEqual(board_grid()[y])
	})
})

describe('run_board_theme_flux_run — arcs and bolts', () => {
	it('crackles arcs in the last ticks of the run only', () => {
		const early = board_grid()
		const late = board_grid()

		draw_arcs(CONTEXT, early, { lane: undefined, t: -16, tick: 74 })
		draw_arcs(CONTEXT, late, { lane: undefined, t: -1, tick: 89 })

		expect(early).toStrictEqual(board_grid())
		expect(late).not.toStrictEqual(board_grid())
	})

	it('keeps the bolts off the notice', () => {
		const grid = board_grid()
		const { notice } = HOST.layout

		draw_bolts(CONTEXT, grid, -1, 80)

		expect(grid[notice.y]?.slice(notice.x, notice.end)).toStrictEqual(
			board_grid()[notice.y]?.slice(notice.x, notice.end),
		)
	})
})
