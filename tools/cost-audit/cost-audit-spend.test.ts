import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_spend } from './cost-audit-spend'

// joshuafolkken/kit#6899: a row's dollars by billed model and token type, priced by the price table
// alone, so the terms sum to the row's total.

const MILLION = 1_000_000
const OPUS = 'claude-opus-4-6'
const HAIKU = 'claude-haiku-4-5'

// One million of every token type but cache read, which is ten million.
const MIXED_TOTALS = {
	...cost_usage.EMPTY_TOTALS,
	input_tokens: MILLION,
	cache_read_tokens: 10 * MILLION,
	cache_write_5m_tokens: MILLION,
	cache_write_1h_tokens: MILLION,
	output_tokens: MILLION,
}

function on(model: string, record: UsageRecord): UsageRecord {
	return { ...record, model }
}

const RECORDS: ReadonlyArray<UsageRecord> = [
	on(HAIKU, cost_audit_fixture.record('h1', 1, 1)),
	on(OPUS, { ...cost_audit_fixture.record('o1', 2, 0), totals: MIXED_TOTALS }),
	on(HAIKU, cost_audit_fixture.record('h2', 3, 1)),
	on('unpriced-model', cost_audit_fixture.record('u1', 4, 3)),
]

describe('cost_audit_spend.spend_of — dollars by model and token type', () => {
	it('prices each token type of each model, the costliest model first', () => {
		expect(cost_audit_spend.spend_of(RECORDS)).toStrictEqual([
			{ model: OPUS, input: 5, cache_read: 5, cache_write: 16.25, output: 25 },
			{ model: HAIKU, input: 2, cache_read: 0, cache_write: 0, output: 0 },
		])
	})

	it('sums to the priced total of the same requests, leaving an unpriced model out of both', () => {
		const spends = cost_audit_spend.spend_of(RECORDS)
		const sum = spends.reduce((total, spend) => total + cost_audit_spend.total_of(spend), 0)

		expect(sum).toBeCloseTo(cost_pricing.cost_of(RECORDS))
	})

	it('answers no model for no request', () => {
		expect(cost_audit_spend.spend_of([])).toStrictEqual([])
	})
})
