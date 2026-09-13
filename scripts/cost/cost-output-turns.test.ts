import { describe, expect, it } from 'vitest'
import { cost_output_turns } from './cost-output-turns'
import { cost_usage, type UsageRecord } from './cost-usage'

function turn(output_tokens: number): UsageRecord {
	return {
		request_id: `req-${String(output_tokens)}`,
		model: 'claude-opus-4-8',
		branch: '1912-lane',
		at_ms: 0,
		totals: { ...cost_usage.EMPTY_TOTALS, output_tokens },
	}
}

describe('cost_output_turns.build', () => {
	it('reports the quantiles and the over-threshold concentration', () => {
		const turns = [100, 200, 300, 6000, 7000].map((output) => turn(output))

		const distribution = cost_output_turns.build(turns)

		expect(distribution.turn_count).toBe(5)
		expect(distribution.median).toBe(300)
		expect(distribution.p90).toBe(7000)
		expect(distribution.max).toBe(7000)
		expect(distribution.over_threshold_count).toBe(2)
		// 13,000 of 13,600 output tokens came from the two turns over 5k.
		expect(distribution.over_threshold_share).toBeCloseTo(13_000 / 13_600, 10)
		expect(distribution.is_measured).toBe(true)
	})

	it('counts a turn exactly at the threshold as under it', () => {
		const at_threshold = [cost_output_turns.LARGE_OUTPUT_THRESHOLD].map((output) => turn(output))
		const distribution = cost_output_turns.build(at_threshold)

		expect(distribution.over_threshold_count).toBe(0)
	})

	// No turn read means the quantiles are unknown, not zero.
	it('is not measured for an empty run', () => {
		const distribution = cost_output_turns.build([])

		expect(distribution.is_measured).toBe(false)
		expect(distribution.turn_count).toBe(0)
		expect(distribution.threshold).toBe(cost_output_turns.LARGE_OUTPUT_THRESHOLD)
	})
})
