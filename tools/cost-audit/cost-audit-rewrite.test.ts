import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { cost_audit_rewrite } from './cost-audit-rewrite'

const MODEL = 'claude-opus-5-5'
const MINUTE_MS = 60_000
const CONTEXT = 66_000
const APPENDED = 20_000
// Opus 5.5 writes the short-TTL cache at 1.25x its $4 input rate: $5 per million tokens.
const REWRITE_USD = 0.33

function request(minute: number, read: number, write: number): UsageRecord {
	return {
		request_id: `r-${String(minute)}`,
		model: MODEL,
		branch: '',
		at_ms: minute * MINUTE_MS,
		totals: { ...cost_usage.EMPTY_TOTALS, cache_read_tokens: read, cache_write_5m_tokens: write },
	}
}

function always(): boolean {
	return true
}

function rewrites_of(
	records: ReadonlyArray<UsageRecord>,
): ReturnType<typeof cost_audit_rewrite.rewrites_in> {
	return cost_audit_rewrite.rewrites_in([{ records }], always)
}

describe('cost_audit_rewrite.rewrites_in — which writes are full rewrites', () => {
	it('counts a rewrite after a wait of the TTL or more, priced at its cache write', () => {
		const result = rewrites_of([request(0, CONTEXT, 0), request(6, 0, CONTEXT)])

		expect(result.after_wait.count).toBe(1)
		expect(result.after_wait.usd).toBeCloseTo(REWRITE_USD)
		expect(result.within_ttl.count).toBe(0)
	})

	it('counts a rewrite inside the TTL apart, as a changed prefix', () => {
		const result = rewrites_of([request(0, CONTEXT, 0), request(2, 0, CONTEXT)])

		expect(result.within_ttl.count).toBe(1)
		expect(result.after_wait.count).toBe(0)
	})

	it('never counts a large write appended after a prefix read back in full', () => {
		const result = rewrites_of([request(0, CONTEXT, 0), request(1, CONTEXT, APPENDED)])

		expect(result.within_ttl.count).toBe(0)
	})

	it('never counts a session first request, nor a write under the floor', () => {
		const result = rewrites_of([request(0, 0, CONTEXT), request(10, 0, 1000)])

		expect(result.after_wait.count).toBe(0)
	})

	it('pairs requests in time order and counts only those the window holds', () => {
		const records = [request(9, 0, CONTEXT), request(0, CONTEXT, 0)]
		const result = cost_audit_rewrite.rewrites_in([{ records }], (at_ms) => at_ms !== 0)
		const outside = cost_audit_rewrite.rewrites_in([{ records }], (at_ms) => at_ms === 0)

		expect(result.after_wait.count).toBe(1)
		expect(outside.after_wait.count).toBe(0)
	})
})
