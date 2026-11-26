import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'

// joshuafolkken/kit#8917: the BTTF theme's speed cruises, climbs for PROGRESS and ROW, and jumps to 88.

const { TOP_SPEED, cruise_of, eased, jump_speed, motion_of, stage_of } = run_board_theme_flux_motion
const { state_at } = run_board_theme_flux_fixture
const SPAN = { typing: 10, rise: 5, fall: 4 }

describe('run_board_theme_flux_motion', () => {
	it('cruises at 28, swaying', () => {
		expect(cruise_of(0)).toBe(28)
		expect(cruise_of(14)).toBeGreaterThan(32)
	})

	it('climbs to 88 at the jump and thaws back to the cruise', () => {
		expect(jump_speed(-81, 80, 28)).toBeUndefined()
		expect(jump_speed(-80, 80, 28)).toBe(28)
		expect(jump_speed(0, 80, 28)).toBe(TOP_SPEED)
		expect(jump_speed(13 + 45, 80, 28)).toBeUndefined()
	})

	it('stages the run up, before the jump only', () => {
		expect(stage_of(-80, 80)).toBe(1)
		expect(stage_of(-1, 80)).toBe(4)
		expect(stage_of(0, 80)).toBeUndefined()
	})

	it('eases a line’s climb while it types and its fall after', () => {
		expect(eased(28, 72, -1, SPAN)).toBeUndefined()
		expect(eased(28, 72, 4, SPAN)).toBe(72)
		expect(eased(28, 72, 12, SPAN)).toBe(50)
		expect(eased(28, 72, 14, SPAN)).toBeUndefined()
	})

	it('has no jump with no notice, and one from the notice’s length', () => {
		expect(motion_of(state_at('i', 50)).t).toBeUndefined()
		const jump = motion_of(state_at('n', 90))

		expect(jump.t).toBe(0)
		expect(jump.speed_at(90)).toBe(TOP_SPEED)
		expect(jump.flux).toStrictEqual({ flood: 15, is_orange: false })
		expect(jump.gauge).toStrictEqual({ climb: 26, is_flooded: true })
	})
})
