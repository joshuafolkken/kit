import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_typing } from './run-board-theme-nixie-typing'

// joshuafolkken/kit#8917: STEINS;GATE while an event types — nothing moves when nothing types, and a
// lane rolling in spins digits about the board.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { rolling_letters, sparks, spinning_digits } = run_board_theme_nixie_typing
const IDLE = state_of(HOST.layout, HOST.events.i, 0)
const ROW = state_of(HOST.layout, HOST.events.r, 30)

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_nixie_typing', () => {
	it('leaves the board alone when nothing types', () => {
		const grid = board_copy()
		const frame = { api: HOST.api, grid, state: IDLE, tick: 30 }

		spinning_digits(frame)
		sparks(frame)
		rolling_letters(frame, IDLE.row)
		expect(grid).toStrictEqual(HOST.board)
	})

	it('spins digits and rolls letters while a lane types', () => {
		const grid = board_copy()
		const frame = { api: HOST.api, grid, state: ROW, tick: 30 }

		spinning_digits(frame)
		rolling_letters(frame, ROW.row, 8)
		expect(grid).not.toStrictEqual(HOST.board)
	})
})
