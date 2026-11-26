import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_data } from './run-board-theme-magi-data'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'
import { run_board_theme_magi_wash } from './run-board-theme-magi-wash'

// joshuafolkken/kit#8917: the MAGI theme's red wash and idle pulse.

const { banded_lamp, lamp_lift, pace_of, red_level, red_wash } = run_board_theme_magi_wash
const { PACES } = run_board_theme_magi_data
const { HOST, state_at } = run_board_theme_magi_fixture

describe('run_board_theme_magi_wash.lamp_lift', () => {
	it('lifts the band’s core most and its shoulders less', () => {
		expect([0, 9, 10, 19, 20, 29, 30, 89].map((at) => lamp_lift(at))).toStrictEqual([
			0.14, 0.14, 0.28, 0.28, 0.14, 0.14, 0, 0,
		])
	})

	it('steps the level in eighths under the band', () => {
		expect(banded_lamp(1, 30, 0)).toBe(0.72)
		expect(banded_lamp(0.3, 30, 0)).toBeCloseTo(0.375 * 0.72)
	})
})

describe('run_board_theme_magi_wash.red_level and red_wash', () => {
	it('is clear while no notice is active', () => {
		expect(red_level(state_at('i', 40))).toBe(0)
		expect(red_wash(HOST.layout, { x: 0, y: 0 }, 40, state_at('i', 40))).toBeUndefined()
	})

	it('rises while the notice builds and washes the notice’s row', () => {
		const state = state_at('n', 30)

		expect(red_level(state)).toBeGreaterThan(0.15)
		expect(red_wash(HOST.layout, { x: 0, y: HOST.layout.notice.y }, 30, state)).toMatch(
			/^\d+;\d+;\d+$/u,
		)
	})
})

describe('run_board_theme_magi_wash.pace_of', () => {
	it('quickens from idle to progress to row', () => {
		expect(pace_of(state_at('i', 40))).toBe(PACES.idle)
		expect(pace_of(state_at('p', 12))).toBe(PACES.progress)
		expect(pace_of(state_at('r', 30))).toBe(PACES.row)
	})
})
