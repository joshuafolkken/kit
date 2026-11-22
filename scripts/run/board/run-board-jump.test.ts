import { describe, expect, it } from 'vitest'
import { run_board_jump } from './run-board-jump'

// joshuafolkken/kit#8677: the bttf time jump's and arrival's timelines in ticks.

const {
	ARRIVE_TICKS,
	THAW_AT,
	TICK_MS,
	TOP_SPEED,
	arrive_speed,
	climb_of,
	flash_of,
	flood_of,
	is_orange,
	is_over,
	is_running,
	jump_speed,
	lead_of,
	stage_of,
	tick_of,
} = run_board_jump
const RUN = { start_ms: 1000, letters: 10 }
const LETTERS = 30
const CRUISE = 40
// The jump is over this many ticks after it: its fire trails burned out (58 ticks, crossing in 20).
const OVER_TICK = 78
// The thaw is over this many ticks after it: its wash and its thaw, when the speed is back at cruise.
const THAWED_TICK = 58

function ms_at(tick: number): number {
	return RUN.start_ms + (tick + RUN.letters) * TICK_MS
}

describe('run_board_jump.tick_of', () => {
	it('counts ticks from the jump, which falls on the tick after the last letter', () => {
		expect(tick_of(RUN, RUN.start_ms)).toBe(-RUN.letters)
		expect(tick_of(RUN, RUN.start_ms + RUN.letters * TICK_MS)).toBe(0)
		expect(tick_of(RUN, RUN.start_ms + RUN.letters * TICK_MS + TICK_MS - 1)).toBe(0)
	})
})

describe('run_board_jump.is_running / is_over', () => {
	it('runs from the first letter until the wash, the thaw and the fire trails are done', () => {
		expect(is_running(RUN, RUN.start_ms - 1)).toBe(false)
		expect(is_running(RUN, RUN.start_ms)).toBe(true)
		expect(is_running(RUN, ms_at(OVER_TICK - 1))).toBe(true)
		expect(is_running(RUN, ms_at(OVER_TICK))).toBe(false)
		expect(is_over(RUN, ms_at(OVER_TICK - 1))).toBe(false)
		expect(is_over(RUN, ms_at(OVER_TICK))).toBe(true)
	})
})

describe('run_board_jump.jump_speed', () => {
	it('climbs from the cruise to 88 through the run up, never falling', () => {
		const speeds = Array.from({ length: LETTERS }, (_, index) =>
			jump_speed(index - LETTERS, LETTERS, CRUISE),
		)

		expect(speeds[0]).toBe(CRUISE)
		expect(speeds.at(-1)).toBe(TOP_SPEED)
		expect(speeds.every((speed, index) => (speed ?? 0) >= (speeds[index - 1] ?? 0))).toBe(true)
	})

	it('holds 88 through the wash and brakes towards the cruise through the thaw', () => {
		expect(jump_speed(0, LETTERS, CRUISE)).toBe(TOP_SPEED)
		expect(jump_speed(13, LETTERS, CRUISE)).toBe(TOP_SPEED)
		expect(jump_speed(THAWED_TICK - 1, LETTERS, CRUISE)).toBeCloseTo(41.07, 1)
	})

	it('has no speed outside the jump', () => {
		expect(jump_speed(-LETTERS - 1, LETTERS, CRUISE)).toBeUndefined()
		expect(jump_speed(THAWED_TICK, LETTERS, CRUISE)).toBeUndefined()
	})
})

describe('run_board_jump.arrive_speed', () => {
	it('holds 88 until the thaw, brakes through it and has none once the arrival is over', () => {
		expect(arrive_speed(0, CRUISE)).toBe(TOP_SPEED)
		expect(arrive_speed(THAW_AT, CRUISE)).toBe(TOP_SPEED)
		expect(arrive_speed(ARRIVE_TICKS - 1, CRUISE)).toBeCloseTo(41.07, 1)
		expect(arrive_speed(ARRIVE_TICKS, CRUISE)).toBeUndefined()
	})
})

describe('run_board_jump.stage_of', () => {
	it('steps the gauge up with the letters typed through the run up', () => {
		expect(stage_of(-LETTERS, LETTERS)).toBe(1)
		expect(stage_of(-LETTERS + 5, LETTERS)).toBe(2)
		expect(stage_of(-LETTERS + 9, LETTERS)).toBe(3)
		expect(stage_of(-LETTERS + 12, LETTERS)).toBe(4)
	})

	it('has no stage outside the run up', () => {
		expect(stage_of(-LETTERS - 1, LETTERS)).toBeUndefined()
		expect(stage_of(0, LETTERS)).toBeUndefined()
	})
})

describe('run_board_jump.lead_of / climb_of', () => {
	it('floods a third of the run up before the jump, fifteen ticks at most', () => {
		expect(lead_of(LETTERS)).toBe(10)
		expect(lead_of(90)).toBe(15)
		expect(lead_of(2)).toBe(0)
	})

	it('climbs the gauge to full over the last two fifths of the run up before the flood', () => {
		expect(climb_of(LETTERS)).toBe(8)
	})
})

describe('run_board_jump.flood_of / is_orange', () => {
	it('floods from the lead before the jump until the wash is over', () => {
		expect(flood_of(-11, LETTERS)).toBeUndefined()
		expect(flood_of(-10, LETTERS)).toBe(0)
		expect(flood_of(12, LETTERS)).toBe(22)
		expect(flood_of(13, LETTERS)).toBeUndefined()
	})

	it('turns every lamp orange the two ticks before the flood', () => {
		expect(is_orange(-13, LETTERS)).toBe(false)
		expect(is_orange(-12, LETTERS)).toBe(true)
		expect(is_orange(-11, LETTERS)).toBe(true)
		expect(is_orange(-10, LETTERS)).toBe(false)
	})
})

describe('run_board_jump.flash_of', () => {
	it('flashes three times, each whiter, dark between them and once the thaw starts', () => {
		expect([0, 4, 5, 6, 10, 11, 12].map((tick) => flash_of(tick))).toStrictEqual([
			0, 0.35, 0.35, 0, 0.65, 0.65, 0,
		])
		expect([16, 17, 18, THAW_AT].map((tick) => flash_of(tick))).toStrictEqual([1, 1, 1, 0])
	})
})
