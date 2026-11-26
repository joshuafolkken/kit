import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_giant } from './run-board-theme-nixie-giant'

// joshuafolkken/kit#8917: STEINS;GATE's giant meter — a digit's cells and their bars, and the
// phases of a notice it spins and locks through.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { giant_digit, giant_meter, giant_phase, segments_at } = run_board_theme_nixie_giant

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

describe('run_board_theme_nixie_giant.segments_at', () => {
	it('finds the bars a cell belongs to', () => {
		expect(segments_at(0, 0)).toStrictEqual(['a', 'f'])
		expect(segments_at(8, 4)).toStrictEqual(['g', 'b', 'c'])
		expect(segments_at(4, 7)).toStrictEqual(['d'])
		expect(segments_at(4, 2)).toStrictEqual([])
	})
})

describe('run_board_theme_nixie_giant.giant_digit', () => {
	it('draws a one lit on its right bars only', () => {
		const grid = board_copy()

		giant_digit(grid, { y: 10, x: 0 }, { ch: '1', style: 'L', ghost: 'G' })
		expect(grid[10]?.slice(0, 9).map(([, style]) => style)).toStrictEqual([
			'G',
			'G',
			'G',
			'G',
			'G',
			'G',
			'G',
			'L',
			'L',
		])
	})
})

describe('run_board_theme_nixie_giant.giant_phase', () => {
	it('spins once the mail is in, locks after the peak, and is gone otherwise', () => {
		const phases = [0, 20, 60, 120].map((tick) =>
			giant_phase(state_of(HOST.layout, HOST.events.n, tick)),
		)

		expect(phases).toStrictEqual([undefined, undefined, 'spin', 'lock'])
	})

	it('takes the area only while it plays', () => {
		const grid = board_copy()
		const idle = { api: HOST.api, grid, state: state_of(HOST.layout, HOST.events.i, 0), tick: 0 }

		expect(giant_meter(idle)).toBe(false)
		expect(giant_meter({ ...idle, state: state_of(HOST.layout, HOST.events.n, 120) })).toBe(true)
	})
})
