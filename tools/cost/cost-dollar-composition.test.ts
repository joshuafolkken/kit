import { cost_pricing, type ModelCost } from '#scripts/cost-runtime/cost-pricing'
import type { UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { cost_dollar_composition } from './cost-dollar-composition'

const ONE_MILLION = 1_000_000
// claude-opus-4-8 is priced input 5 / output 25 per million; the multipliers are 1.25 / 2 / 0.1.
const OPUS = 'claude-opus-4-8'
const CLOSE = 10

function totals(over: Partial<UsageTotals>): UsageTotals {
	return {
		input_tokens: 0,
		cache_write_5m_tokens: 0,
		cache_write_1h_tokens: 0,
		cache_read_tokens: 0,
		output_tokens: 0,
		thinking_tokens: 0,
		thinking_measured: false,
		...over,
	}
}

function model_cost(model: string, over: Partial<UsageTotals>): ModelCost {
	return { model, totals: totals(over) }
}

describe('cost_dollar_composition.build — pricing', () => {
	it('prices each token type by its own multiplier', () => {
		const one_of_each = model_cost(OPUS, {
			input_tokens: ONE_MILLION,
			cache_write_5m_tokens: ONE_MILLION,
			cache_write_1h_tokens: ONE_MILLION,
			cache_read_tokens: ONE_MILLION,
			output_tokens: ONE_MILLION,
		})

		const composition = cost_dollar_composition.build([one_of_each])

		expect(composition.input_usd).toBeCloseTo(5, CLOSE)
		expect(composition.cache_write_5m_usd).toBeCloseTo(6.25, CLOSE)
		expect(composition.cache_write_1h_usd).toBeCloseTo(10, CLOSE)
		expect(composition.cache_read_usd).toBeCloseTo(0.5, CLOSE)
		expect(composition.output_usd).toBeCloseTo(25, CLOSE)
	})

	it('sums the five terms to the priced cost_usd', () => {
		const totals_in = totals({
			input_tokens: 2,
			cache_write_5m_tokens: 40_000,
			cache_write_1h_tokens: 97_190,
			cache_read_tokens: 500_000,
			output_tokens: 1234,
		})
		const price = cost_pricing.resolve_price(OPUS)

		if (price === undefined) throw new Error('opus should be priced')

		const composition = cost_dollar_composition.build([{ model: OPUS, totals: totals_in }])

		expect(composition.total_usd).toBeCloseTo(cost_pricing.estimate_cost(totals_in, price), CLOSE)
	})
})

describe('cost_dollar_composition.build — aggregation', () => {
	it('sums across models of different tiers', () => {
		const opus = model_cost(OPUS, { input_tokens: ONE_MILLION })
		const haiku = model_cost('claude-haiku-4-5', { input_tokens: ONE_MILLION })

		const composition = cost_dollar_composition.build([opus, haiku])

		expect(composition.input_usd).toBeCloseTo(6, CLOSE)
		expect(composition.unpriced_models).toEqual([])
	})

	// An unknown model id contributes its tokens and no dollars, and is named so the split reads as a
	// floor rather than a run that spent nothing on it.
	it('records an unpriced model and adds none of its dollars', () => {
		const unknown_id = 'claude-nonesuch-9'
		const known = model_cost(OPUS, { output_tokens: ONE_MILLION })
		const unknown = model_cost(unknown_id, { output_tokens: ONE_MILLION })

		const composition = cost_dollar_composition.build([known, unknown])

		expect(composition.output_usd).toBeCloseTo(25, CLOSE)
		expect(composition.unpriced_models).toEqual([unknown_id])
	})

	it('is all zero for an empty set', () => {
		const composition = cost_dollar_composition.build([])

		expect(composition.total_usd).toBe(0)
		expect(composition.unpriced_models).toEqual([])
	})
})
