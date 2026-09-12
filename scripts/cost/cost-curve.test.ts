import { describe, expect, it } from 'vitest'
import { cost_curve } from './cost-curve'
import { cost_usage, type UsageRecord } from './cost-usage'

const OPUS = 'claude-opus-5'
const IMAGINARY = 'claude-imaginary-9'
const MILLION = 1_000_000

function record(input_tokens: number, model: string = OPUS): UsageRecord {
	return {
		request_id: `r${String(input_tokens)}-${model}`,
		model,
		branch: 'main',
		at_ms: undefined,
		totals: { ...cost_usage.EMPTY_TOTALS, input_tokens },
	}
}

// Eight requests whose context climbs 100K → 800K, so each quartile holds two and the last is the
// largest — the growth curve the report exists to show.
function climbing(): Array<UsageRecord> {
	return Array.from({ length: 8 }, (_unused, index) => record((index + 1) * 100_000))
}

describe('cost_curve.build_curve', () => {
	it('splits the run into four positional quartiles', () => {
		expect(cost_curve.build_curve(climbing()).buckets).toHaveLength(4)
	})

	it('keeps the requests in order rather than sorting them by size', () => {
		const curve = cost_curve.build_curve(climbing())

		expect(curve.first_context_tokens).toBe(100_000)
		expect(curve.last_context_tokens).toBe(800_000)
	})

	it('averages the context within each quartile, growing across the run', () => {
		const { buckets } = cost_curve.build_curve(climbing())

		expect(buckets[0]?.avg_context_tokens).toBe(150_000)
		expect(buckets[3]?.avg_context_tokens).toBe(750_000)
	})

	it('prices each quartile', () => {
		const { buckets } = cost_curve.build_curve(climbing())

		expect(buckets[0]?.cost_usd).toBeCloseTo(((100_000 + 200_000) * 5) / MILLION)
	})

	// A run of three requests cannot fill four quartiles; the empty one says so rather than reading 0.
	it('withholds the average of an empty quartile rather than reporting zero', () => {
		const { buckets } = cost_curve.build_curve([record(100), record(200), record(300)])

		expect(buckets[3]?.request_count).toBe(0)
		expect(buckets[3]?.avg_context_tokens).toBeUndefined()
	})

	// A quartile holding a model the table cannot price reports no cost rather than a partial one.
	it('withholds a quartile cost when it holds an unpriced model', () => {
		const records = [record(100, IMAGINARY), record(200), record(300), record(400)]

		expect(cost_curve.build_curve(records).buckets[0]?.cost_usd).toBeUndefined()
	})
})

describe('cost_curve.simulate_cap', () => {
	// context 200K (cost $1) and 800K (cost $4).
	const two = [record(200_000), record(800_000)]

	it('counts the requests at or under the cap', () => {
		expect(cost_curve.simulate_cap(two, 500_000).within_cap_requests).toBe(1)
	})

	it('returns the share of priced cost incurred at or under the cap', () => {
		expect(cost_curve.simulate_cap(two, 500_000).cost_ratio).toBeCloseTo(0.2)
	})

	it('counts a cap above every request as the whole run', () => {
		const sim = cost_curve.simulate_cap(two, MILLION)

		expect(sim.within_cap_requests).toBe(2)
		expect(sim.cost_ratio).toBe(1)
	})

	// The withheld convention: nothing priced is "not measured", never a ratio of 0.
	it('withholds the ratio when nothing could be priced', () => {
		const unpriced = [record(100, IMAGINARY), record(200, IMAGINARY)]

		expect(cost_curve.simulate_cap(unpriced, 500_000).cost_ratio).toBeUndefined()
	})
})

describe('cost_curve formatting', () => {
	it('renders the quartile lines and the first-to-last growth', () => {
		const lines = cost_curve.format_curve_lines(cost_curve.build_curve(climbing())).join('\n')

		expect(lines).toContain('Cost curve')
		expect(lines).toContain('Q1')
		expect(lines).toContain('Q4')
	})

	it('prints "not measured" for a withheld ratio', () => {
		const sim = cost_curve.simulate_cap([record(100, IMAGINARY)], 500_000)

		expect(cost_curve.format_cap_lines(sim).join('\n')).toContain(cost_curve.NOT_MEASURED)
	})
})
