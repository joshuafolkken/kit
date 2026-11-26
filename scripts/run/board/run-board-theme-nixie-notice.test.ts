import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_notice } from './run-board-theme-nixie-notice'

// joshuafolkken/kit#8917: STEINS;GATE's D-mail — the discharges' path stays in the area, and the
// notice's layers stay off an idle board.

const { HOST } = run_board_theme_host_fixture
const { layout } = HOST
const { state_of } = run_board_theme_host_state
const { aftershocks, bolt_char, discharge, dissolve, next_y, resettle } =
	run_board_theme_nixie_notice

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_nixie_notice.next_y', () => {
	it('steps up, down or along, never out of the area', () => {
		expect(next_y(layout, layout.area_top, 0.1)).toBe(layout.area_top)
		expect(next_y(layout, layout.area_end, 0.9)).toBe(layout.area_end)
		expect(next_y(layout, layout.area_top, 0.9)).toBe(layout.area_top + 1)
		expect(next_y(layout, layout.area_top + 1, 0.5)).toBe(layout.area_top + 1)
	})
})

describe('run_board_theme_nixie_notice.bolt_char', () => {
	it('draws a rise, a fall or a level stretch', () => {
		expect([bolt_char(4, 5), bolt_char(6, 5), bolt_char(5, 5)]).toStrictEqual(['╱', '╲', '─'])
	})
})

describe('run_board_theme_nixie_notice layers', () => {
	it('leave an idle board alone', () => {
		const grid = board_copy()
		const frame = { api: HOST.api, grid, state: state_of(layout, HOST.events.i, 0), tick: 0 }

		dissolve(frame)
		discharge(frame)
		resettle(frame)
		aftershocks(frame)
		expect(grid).toStrictEqual(HOST.board)
	})

	it('dissolve the board while a notice types', () => {
		const grid = board_copy()

		dissolve({ api: HOST.api, grid, state: state_of(layout, HOST.events.n, 80), tick: 80 })
		expect(grid).not.toStrictEqual(HOST.board)
	})
})
