import { describe, expect, it } from 'vitest'
import { cost_pricing } from './cost-pricing'
import { cost_usage, type UsageTotals } from './cost-usage'

const MILLION = 1_000_000
const OPUS_PRICE = { input: 5, output: 25 }
const OPUS = 'claude-opus-5'
const IMAGINARY = 'claude-imaginary-9'

function totals(overrides: Partial<UsageTotals> = {}): UsageTotals {
	return { ...cost_usage.EMPTY_TOTALS, ...overrides }
}

function million_of(key: keyof UsageTotals): number {
	return cost_pricing.estimate_cost(totals({ [key]: MILLION }), OPUS_PRICE)
}

describe('cost_pricing.resolve_price', () => {
	it('prices a known model', () => {
		expect(cost_pricing.resolve_price(OPUS)).toStrictEqual(OPUS_PRICE)
	})

	it('prices an id carrying a context-window marker', () => {
		expect(cost_pricing.resolve_price(`${OPUS}[1m]`)).toStrictEqual(OPUS_PRICE)
	})

	it('prices an id carrying a date suffix', () => {
		expect(cost_pricing.resolve_price('claude-haiku-4-5-20251001')?.input).toBe(1)
	})

	it('returns nothing for a model the table does not know', () => {
		expect(cost_pricing.resolve_price(IMAGINARY)).toBeUndefined()
	})
})

describe('cost_pricing.estimate_cost', () => {
	it('charges uncached input at the base rate', () => {
		expect(cost_pricing.estimate_cost(totals({ input_tokens: MILLION }), OPUS_PRICE)).toBe(5)
	})

	it('charges a 5-minute cache write at 1.25x base', () => {
		expect(
			cost_pricing.estimate_cost(totals({ cache_write_5m_tokens: MILLION }), OPUS_PRICE),
		).toBeCloseTo(5 * cost_pricing.CACHE_WRITE_5M_MULTIPLIER)
	})

	it('charges a 1-hour cache write at 2x base', () => {
		expect(
			cost_pricing.estimate_cost(totals({ cache_write_1h_tokens: MILLION }), OPUS_PRICE),
		).toBeCloseTo(5 * cost_pricing.CACHE_WRITE_1H_MULTIPLIER)
	})

	it('charges a cache read at a tenth of base', () => {
		expect(
			cost_pricing.estimate_cost(totals({ cache_read_tokens: MILLION }), OPUS_PRICE),
		).toBeCloseTo(5 * cost_pricing.CACHE_READ_MULTIPLIER)
	})

	it('charges output at the output rate', () => {
		expect(cost_pricing.estimate_cost(totals({ output_tokens: MILLION }), OPUS_PRICE)).toBe(25)
	})

	// The whole reason the multipliers are kept apart: a million cache reads and a million uncached
	// input tokens are the same token count and prices that differ by a factor of fifty against output.
	it('keeps the three input kinds at different prices', () => {
		const uncached = million_of('input_tokens')
		const written = million_of('cache_write_1h_tokens')
		const read = million_of('cache_read_tokens')

		expect(written).toBeGreaterThan(uncached)
		expect(read).toBeLessThan(uncached)
	})
})

describe('cost_pricing.cost_by_model', () => {
	it('groups requests by model and prices each', () => {
		const costs = cost_pricing.cost_by_model([
			{ model: OPUS, totals: totals({ output_tokens: MILLION }) },
			{ model: 'claude-haiku-4-5', totals: totals({ output_tokens: MILLION }) },
		])

		expect(costs.map((entry) => entry.cost_usd)).toStrictEqual([25, 5])
	})

	it('leaves an unknown model unpriced rather than free', () => {
		const costs = cost_pricing.cost_by_model([
			{ model: IMAGINARY, totals: totals({ output_tokens: MILLION }) },
		])

		expect(costs[0]?.cost_usd).toBeUndefined()
	})
})

describe('cost_pricing.total_cost', () => {
	it('sums what could be priced and names what could not', () => {
		const result = cost_pricing.total_cost(
			cost_pricing.cost_by_model([
				{ model: OPUS, totals: totals({ output_tokens: MILLION }) },
				{ model: IMAGINARY, totals: totals({ output_tokens: MILLION }) },
			]),
		)

		expect(result.usd).toBe(25)
		expect(result.unpriced).toStrictEqual([IMAGINARY])
	})
})
