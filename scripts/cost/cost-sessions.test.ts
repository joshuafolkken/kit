import { describe, expect, it } from 'vitest'
import type { AttributedRecord } from './cost-corpus'
import { cost_sessions } from './cost-sessions'
import { cost_usage, type UsageRecord } from './cost-usage'

const OPUS = 'claude-opus-4-8'
const MINUTE = 60_000
const ISSUE = 1912
const CLOSE = 10

function record(request_id: string, at_minute: number, output_tokens: number): UsageRecord {
	return {
		request_id,
		model: OPUS,
		branch: '1912-lane',
		at_ms: at_minute * MINUTE,
		totals: { ...cost_usage.EMPTY_TOTALS, input_tokens: 1000, output_tokens },
	}
}

function pair(
	session_id: string,
	baseline: number,
	rec: UsageRecord,
	is_delegated = false,
): AttributedRecord {
	return { record: rec, issue: ISSUE, baseline_tokens: baseline, session_id, is_delegated }
}

// A run stopped in `session-a` and resumed in `session-b`, with one subagent launched from `session-a`.
const PAIRS: Array<AttributedRecord> = [
	pair('session-b', 94_000, record('b1', 10, 6000)),
	pair('session-b', 94_000, record('b2', 11, 300)),
	pair('session-a', 90_000, record('a1', 1, 100)),
	pair('session-a', 90_000, record('a2', 2, 200)),
	pair('session-a/agent-1', 5000, record('u1', 2, 50), true),
]

describe('cost_sessions.build — the session axis', () => {
	it('orders sessions oldest first and marks the resume', () => {
		const sessions = cost_sessions.build(PAIRS)

		expect(sessions.map((one) => one.session_id)).toEqual(['session-a', 'session-b'])
		expect(sessions.map((one) => one.is_resumed)).toEqual([false, true])
	})

	it('excludes delegated records from a session row but counts its own', () => {
		const [first] = cost_sessions.build(PAIRS)

		expect(first?.request_count).toBe(2)
		expect(first?.output_tokens).toBe(300)
	})

	// The resume session's preamble is the context it re-established before doing any work.
	it('reports the resume preamble tokens', () => {
		const sessions = cost_sessions.build(PAIRS)

		expect(sessions[1]?.preamble_tokens).toBe(94_000)
	})
})

describe('cost_sessions.build — money and output', () => {
	it('adds the spawned unit to cost_usd_with_delegated', () => {
		const [first] = cost_sessions.build(PAIRS)

		expect(first?.cost_usd_with_delegated).toBeGreaterThan(first?.cost_usd ?? 0)
	})

	it('composes the per-session dollars to the session cost', () => {
		const [first] = cost_sessions.build(PAIRS)

		expect(first?.composition.total_usd).toBeCloseTo(first?.cost_usd ?? -1, CLOSE)
	})

	it('counts the resume session large-output turn', () => {
		const sessions = cost_sessions.build(PAIRS)

		expect(sessions[1]?.output_turns.over_threshold_count).toBe(1)
	})
})

describe('cost_sessions.build — the per-session metrics', () => {
	it('carries the model and context distribution on each row', () => {
		const [first] = cost_sessions.build(PAIRS)

		expect(first?.metrics.primary_model).toBe(OPUS)
		expect(first?.metrics.context.sample_count).toBe(2)
	})
})
