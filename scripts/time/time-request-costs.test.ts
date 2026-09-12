import type { AttributedRecord } from '#scripts/cost/cost-corpus'
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

// joshuafolkken/kit#1882: each delegated session's launch cost, derived from the same walk the phase
// costs read — its context-construction request found by the billed input that defines its baseline.
const ISSUE_N = 1

interface UnitFixture {
	session_id: string
	is_delegated: boolean
	input_tokens: number
	baseline_tokens: number
	model?: string
}

function attributed(fixture: UnitFixture): AttributedRecord {
	return {
		record: {
			request_id: 'req',
			model: fixture.model ?? OPUS,
			branch: 'main',
			at_ms: undefined,
			totals: { ...cost_usage.EMPTY_TOTALS, input_tokens: fixture.input_tokens },
		},
		issue: ISSUE_N,
		baseline_tokens: fixture.baseline_tokens,
		session_id: fixture.session_id,
		is_delegated: fixture.is_delegated,
	}
}

function delegated(
	session_id: string,
	input_tokens: number,
	baseline_tokens: number,
): AttributedRecord {
	return attributed({ session_id, is_delegated: true, input_tokens, baseline_tokens })
}

describe('time_request_costs.delegated_units — pricing the construction request', () => {
	// The cheap follow-up is first in the array; the priced launch must still be the construction
	// request, the one whose billed input equals the baseline.
	it('prices the construction request, not the first record', () => {
		const units = time_request_costs.delegated_units([
			delegated('agent-a', 10, 500_000),
			delegated('agent-a', 500_000, 500_000),
		])
		const construction = time_request_costs.to_priced(delegated('agent-a', 500_000, 500_000).record)

		expect(units).toHaveLength(1)
		expect(units[0]?.cost_usd).toBe(construction.cost_usd)
	})

	it('marks a unit on a model the table does not know unpriced', () => {
		const bare = attributed({
			session_id: 'agent-b',
			is_delegated: true,
			input_tokens: 100,
			baseline_tokens: 100,
			model: UNKNOWN,
		})

		expect(time_request_costs.delegated_units([bare])[0]).toMatchObject({
			is_priced: false,
			cost_usd: 0,
		})
	})
})

describe('time_request_costs.delegated_units — what it excludes', () => {
	it('ignores a main-line session', () => {
		const main = attributed({
			session_id: 'main',
			is_delegated: false,
			input_tokens: 999,
			baseline_tokens: 999,
		})

		expect(time_request_costs.delegated_units([main])).toEqual([])
	})
})
