import { describe, expect, it } from 'vitest'
import { lane_tail_stats } from './lane-tail-stats'

// joshuafolkken/kit#4910: the tail of the period's lane times — the lanes over the overrun threshold
// and the 90th percentile — beside the median `lane:stats` already prints.

describe('lane_tail_stats.overrun_count', () => {
	it('counts a lane over 40 minutes and not one exactly at it', () => {
		expect(lane_tail_stats.overrun_count([40, 40.1, 12])).toBe(1)
	})

	it('counts nothing with no lane', () => {
		expect(lane_tail_stats.overrun_count([])).toBe(0)
	})
})

describe('lane_tail_stats.tail_minutes', () => {
	it('takes the nearest-rank 90th percentile — the 9th of 10 lanes', () => {
		const minutes = [10, 100, 20, 30, 40, 50, 60, 70, 80, 90]

		expect(lane_tail_stats.tail_minutes(minutes)).toBe(90)
	})

	it('takes the only lane of one', () => {
		expect(lane_tail_stats.tail_minutes([33])).toBe(33)
	})

	it('gives undefined with no lane', () => {
		expect(lane_tail_stats.tail_minutes([])).toBeUndefined()
	})
})
