import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_data } from './run-board-theme-nixie-data'
import { run_board_theme_nixie_shift } from './run-board-theme-nixie-shift'

// joshuafolkken/kit#8917: STEINS;GATE's world line shift — the ticks it flashes on, and the ripple
// and shift only after an event has landed.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { SHIFTS } = run_board_theme_nixie_data
const { is_flash_tick, ripple, world_line_shift } = run_board_theme_nixie_shift

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_nixie_shift.is_flash_tick', () => {
	it('flashes a notice on ticks 0, 3 and 6, a row on 0, a progress never', () => {
		const ticks = [0, 1, 3, 6, 9]
		const { notice, row, progress } = SHIFTS

		expect(ticks.filter((since) => notice && is_flash_tick(notice, since))).toStrictEqual([0, 3, 6])
		expect(ticks.filter((since) => row && is_flash_tick(row, since))).toStrictEqual([0])
		expect(ticks.filter((since) => progress && is_flash_tick(progress, since))).toStrictEqual([])
	})
})

describe('run_board_theme_nixie_shift layers', () => {
	it('leave an idle board alone', () => {
		const grid = board_copy()
		const frame = { api: HOST.api, grid, state: state_of(HOST.layout, HOST.events.i, 0), tick: 0 }

		ripple(frame)
		world_line_shift(frame)
		expect(grid).toStrictEqual(HOST.board)
	})

	it('shift the board just after a lane lands', () => {
		const state = state_of(HOST.layout, HOST.events.r, 10 + HOST.layout.row_text.length)
		const grid = board_copy()

		world_line_shift({ api: HOST.api, grid, state, tick: state.tick })
		expect(state.since).toBeLessThan(10)
		expect(grid).not.toStrictEqual(HOST.board)
	})
})
