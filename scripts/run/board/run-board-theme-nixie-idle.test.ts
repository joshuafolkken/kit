import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_idle } from './run-board-theme-nixie-idle'

// joshuafolkken/kit#8917: STEINS;GATE's idle life — only once idle, a current along the rules that
// heats from the rule's color to a pale amber, and the tubes swelling as it arrives.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { heat_color, idle_current, idle_misread, idle_noise, is_idle, is_swelling } =
	run_board_theme_nixie_idle
const IDLE = state_of(HOST.layout, HOST.events.i, 0)
const TYPING = state_of(HOST.layout, HOST.events.r, 12)

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_nixie_idle.is_idle', () => {
	it('is idle with nothing typing long enough', () => {
		expect([is_idle(IDLE), is_idle(TYPING)]).toStrictEqual([true, false])
	})
})

describe('run_board_theme_nixie_idle.heat_color', () => {
	it('heats from the rule color to a pale amber', () => {
		expect([heat_color(0), heat_color(1)]).toStrictEqual(['120;55;15', '255;210;120'])
	})
})

describe('run_board_theme_nixie_idle.is_swelling', () => {
	it('swells from four ticks before the current arrives for ten ticks after', () => {
		const arrives = Math.ceil(HOST.layout.edge / 4)

		expect(
			[arrives - 5, arrives - 4, arrives + 9, arrives + 10].map((tick) =>
				is_swelling(IDLE, tick, HOST.layout.edge),
			),
		).toStrictEqual([false, true, true, false])
	})
})

describe('run_board_theme_nixie idle layers', () => {
	it('leave the board alone while an event types', () => {
		const grid = board_copy()
		const frame = { api: HOST.api, grid, state: TYPING, tick: 12 }

		idle_noise(frame)
		idle_current(frame)
		idle_misread(frame)
		expect(grid).toStrictEqual(HOST.board)
	})

	it('run a current along the rules when idle', () => {
		const grid = board_copy()

		idle_current({ api: HOST.api, grid, state: IDLE, tick: 10 })
		expect(grid).not.toStrictEqual(HOST.board)
	})
})
