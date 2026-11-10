import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_usage } from './cost-audit-usage'

const { ms, record, session } = cost_audit_fixture
// The period opens at minute 100; a request before it is outside.
const OPENS_MS = ms(100)
const REVIEWER = 'reviewer'

function is_inside(at_ms: number | undefined): boolean {
	return at_ms !== undefined && at_ms >= OPENS_MS
}

function request(id: string, minute: number, totals: Partial<UsageTotals>): UsageRecord {
	const base = record(id, minute, 0)

	return { ...base, totals: { ...base.totals, ...totals } }
}

// A first request whose input and cache write add a fixed hundred to its cache read.
function first(id: string, minute: number, cache_read_tokens: number): UsageRecord {
	return request(id, minute, { input_tokens: 10, cache_read_tokens, cache_write_5m_tokens: 90 })
}

function unit(agent_type: string, records: ReadonlyArray<UsageRecord>): AuditSession {
	return { ...session('subagent', records), agent_type }
}

describe('cost_audit_usage.breakdown_of — the cache write by lifetime', () => {
	it('sums the 5m and 1h tokens inside the period and prices each at its own rate', () => {
		const inside = request('a', 120, { cache_write_5m_tokens: 1000, cache_write_1h_tokens: 400 })
		const sessions = [
			session('fullrun', [request('old', 50, { cache_write_5m_tokens: 9000 }), inside]),
		]
		const write = cost_audit_usage.breakdown_of(sessions, is_inside).cache_write
		const price = cost_pricing.resolve_price(inside.model)
		const terms =
			price === undefined ? undefined : cost_pricing.estimate_composition(inside.totals, price)

		expect(write).toStrictEqual({
			tokens_5m: 1000,
			tokens_1h: 400,
			usd_5m: terms?.cache_write_5m_usd,
			usd_1h: terms?.cache_write_1h_usd,
		})
		// The 1h write at twice the input rate against the 5m write at 1.25 times it.
		expect(write.usd_1h / write.usd_5m).toBeCloseTo(0.64)
	})
})

describe('cost_audit_usage.breakdown_of — subagent runs by agent type', () => {
	it('counts each delegated transcript as a run with its calls, costliest type first', () => {
		const sessions = [
			unit(REVIEWER, [record('r1', 110, 1), record('r2', 111, 1), record('r3', 112, 1)]),
			unit(REVIEWER, [record('r4', 120, 1)]),
			unit('investigator', [record('i1', 130, 0.5)]),
			session('fullrun', [record('m1', 140, 5)]),
		]
		const { agents } = cost_audit_usage.breakdown_of(sessions, is_inside)

		expect(agents.map((agent) => [agent.agent_type, agent.runs, agent.calls])).toStrictEqual([
			[REVIEWER, 2, 4],
			['investigator', 1, 1],
		])
		expect(agents[0]?.usd).toBeCloseTo(4)
	})

	it('leaves out a run whose requests all fall before the period', () => {
		const sessions = [unit(REVIEWER, [record('r1', 10, 1)])]

		expect(cost_audit_usage.breakdown_of(sessions, is_inside).agents).toStrictEqual([])
	})
})

describe('cost_audit_usage.breakdown_of — the first-request context', () => {
	it('takes the median of each session first request, main apart from subagent', () => {
		const sessions = [
			session('fullrun', [first('a', 110, 900), request('a2', 111, { cache_read_tokens: 1 })]),
			session('fullrun', [first('b', 120, 1900)]),
			session('fullrun', [first('c', 130, 2900)]),
			unit(REVIEWER, [first('d', 140, 400)]),
		]
		const breakdown = cost_audit_usage.breakdown_of(sessions, is_inside)

		expect(breakdown.first_main).toStrictEqual({ sessions: 3, p50_tokens: 2000 })
		expect(breakdown.first_subagent).toStrictEqual({ sessions: 1, p50_tokens: 500 })
	})

	it('leaves out a session that opened before the period, not its first request inside', () => {
		const sessions = [
			session('fullrun', [
				request('a', 50, { input_tokens: 7 }),
				request('b', 120, { input_tokens: 9 }),
			]),
		]

		expect(cost_audit_usage.breakdown_of(sessions, is_inside).first_main).toStrictEqual({
			sessions: 0,
			p50_tokens: undefined,
		})
	})
})

describe('cost_audit_usage.breakdown_of — the long-output calls', () => {
	it('counts the calls whose output passed the threshold among all calls inside the period', () => {
		const sessions = [
			session('fullrun', [
				request('a', 110, { output_tokens: cost_audit_usage.LONG_OUTPUT_TOKENS + 1 }),
				request('b', 111, { output_tokens: cost_audit_usage.LONG_OUTPUT_TOKENS }),
				request('c', 112, { output_tokens: 10 }),
				request('d', 50, { output_tokens: 9000 }),
			]),
		]
		const long = cost_audit_usage.breakdown_of(sessions, is_inside).long_output

		expect([long.calls, long.all_calls]).toStrictEqual([1, 3])
		expect(long.usd).toBeGreaterThan(0)
	})
})
