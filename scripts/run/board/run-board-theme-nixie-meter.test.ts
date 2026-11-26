import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_meter } from './run-board-theme-nixie-meter'

// joshuafolkken/kit#8917: STEINS;GATE's divergence meter — the world line each event reaches, the
// point that never spins, and the field named beside the panel.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { divergence_meter, nixie_char, nixie_glow, world_of } = run_board_theme_nixie_meter
const IDLE = state_of(HOST.layout, HOST.events.i, 0)
const AFTER_NOTICE = state_of(HOST.layout, HOST.events.n, 200)

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_nixie_meter.world_of', () => {
	it('reads α before any event and β after a notice', () => {
		expect([world_of(IDLE), world_of(AFTER_NOTICE)]).toStrictEqual([
			{ value: '0.571024', field: 'α' },
			{ value: '1.130426', field: 'β' },
		])
	})
})

describe('run_board_theme_nixie_meter.nixie_char', () => {
	it('never spins the point and spins every tube while busy', () => {
		const busy = {
			api: HOST.api,
			grid: board_copy(),
			state: state_of(HOST.layout, HOST.events.r, 12),
			tick: 12,
		}

		expect(nixie_char(busy, '0.571024', 1)).toStrictEqual({ ch: '.', is_spinning: false })
		expect(nixie_char(busy, '0.571024', 0).is_spinning).toBe(true)
	})
})

describe('run_board_theme_nixie_meter.nixie_glow', () => {
	it('glows hot while spinning', () => {
		const frame = { api: HOST.api, grid: board_copy(), state: IDLE, tick: 0 }

		expect(nixie_glow(frame, true, 0)).toBe('255;200;120')
	})
})

describe('run_board_theme_nixie_meter.divergence_meter', () => {
	it('names the α field beside the panel when idle', () => {
		const grid = board_copy()
		const { y } = HOST.layout.level_spot

		divergence_meter({ api: HOST.api, grid, state: IDLE, tick: 0 })
		expect((grid[y] ?? []).map(([ch]) => ch).join('')).toContain('α ATTRACTOR FIELD')
	})
})
