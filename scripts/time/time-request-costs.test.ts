import { cost_usage, type UsageRecord } from '#scripts/cost/cost-usage'
import { describe, expect, it } from 'vitest'
import { time_request_costs } from './time-request-costs'

// joshuafolkken/kit#1606: the phase attribution needs each billed request as an instant and a price.

const OPUS = 'claude-opus-5'
const UNKNOWN = 'some-model-nobody-priced'
const AT_MS = 1_700_000_000_000

function record(model: string, at_ms: number | undefined): UsageRecord {
	return {
		request_id: 'req_1',
		model,
		branch: 'main',
		at_ms,
		totals: { ...cost_usage.EMPTY_TOTALS, input_tokens: 1_000_000 },
	}
}

describe('time_request_costs.to_priced', () => {
	it('prices a request the table knows', () => {
		expect(time_request_costs.to_priced(record(OPUS, AT_MS)).cost_usd).toBeGreaterThan(0)
	})

	it('carries the instant through unchanged', () => {
		expect(time_request_costs.to_priced(record(OPUS, AT_MS)).at_ms).toBe(AT_MS)
	})

	it('marks a request the table could price', () => {
		expect(time_request_costs.to_priced(record(OPUS, AT_MS)).is_priced).toBe(true)
	})

	// Costed at nothing and *said* to have no price, so the total it feeds is reported as a floor.
	it('costs a model the table does not know at nothing and marks it unpriced', () => {
		const priced = time_request_costs.to_priced(record(UNKNOWN, AT_MS))

		expect([priced.cost_usd, priced.is_priced]).toEqual([0, false])
	})

	// A request that cannot be placed is still priced — dropping it would shrink the run's total.
	it('keeps a request whose instant could not be read', () => {
		expect(time_request_costs.to_priced(record(OPUS, undefined)).at_ms).toBeUndefined()
	})
})
