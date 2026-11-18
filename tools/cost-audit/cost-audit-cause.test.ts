import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import { cost_audit_cause, type Cause, type CauseRow } from './cost-audit-cause'
import { cost_audit_usage } from './cost-audit-usage'

const MODEL = 'claude-opus-5-5'
const MINUTE_MS = 60_000
const CONTEXT = 66_000
const APPENDED = 20_000
const MILLION = 1_000_000
// Opus 5.5 writes the 5m cache at 1.25x and the 1h cache at 2x its $4 input rate.
const USD_5M_PER_MILLION = 5
const USD_1H_PER_MILLION = 8
const PREVIOUS_MINUTE = -100
const [SUBAGENT_START, RESUME_AFTER_CUT, SESSION_START, AFTER_WAIT, OTHER] = cost_audit_cause.CAUSES

interface Writes {
	read?: number
	write_5m?: number
	write_1h?: number
}

function request(minute: number, writes: Writes): UsageRecord {
	const totals = {
		...cost_usage.EMPTY_TOTALS,
		cache_read_tokens: writes.read ?? 0,
		cache_write_5m_tokens: writes.write_5m ?? 0,
		cache_write_1h_tokens: writes.write_1h ?? 0,
	}

	return {
		request_id: `r-${String(minute)}`,
		model: MODEL,
		branch: '',
		at_ms: minute * MINUTE_MS,
		totals,
	}
}

function session(
	kind: string,
	records: ReadonlyArray<UsageRecord>,
	agent_type?: string,
): { kind: string; agent_type: string | undefined; records: ReadonlyArray<UsageRecord> } {
	return { kind, agent_type, records }
}

function is_current(at_ms: number | undefined): boolean {
	return at_ms !== undefined && at_ms >= 0
}

function is_previous(at_ms: number | undefined): boolean {
	return at_ms !== undefined && at_ms < 0
}

type Sessions = Parameters<typeof cost_audit_cause.causes_in>[0]

function rows_of(sessions: Sessions): Array<CauseRow> {
	return cost_audit_cause.causes_in(sessions, { current: is_current, previous: is_previous })
}

function row_of(rows: ReadonlyArray<CauseRow>, cause: Cause): CauseRow | undefined {
	return rows.find((row) => row.cause === cause)
}

function writes_of(sessions: Sessions, cause: Cause): number | undefined {
	return row_of(rows_of(sessions), cause)?.current.writes
}

const OPENING = request(0, { write_5m: CONTEXT })

describe('cost_audit_cause.causes_in — which cause a cache write goes to', () => {
	it('puts a first request on its session start, subagent start or resume after a cut', () => {
		expect(writes_of([session('fullrun', [OPENING])], SESSION_START)).toBe(1)
		expect(writes_of([session('subagent', [OPENING], 'reviewer')], SUBAGENT_START)).toBe(1)
		expect(writes_of([session('resume', [OPENING])], RESUME_AFTER_CUT)).toBe(1)
	})

	it('puts a delegated unit opened by a resume prompt on its subagent start first', () => {
		const rows = rows_of([session('resume', [OPENING], 'reviewer')])

		expect(row_of(rows, SUBAGENT_START)?.current.writes).toBe(1)
		expect(row_of(rows, RESUME_AFTER_CUT)?.current.writes).toBe(0)
	})

	it('puts a full rewrite after a wait of the TTL on its own cause and the rest on other', () => {
		const records = [
			OPENING,
			request(1, { read: CONTEXT, write_5m: APPENDED }),
			request(10, { write_5m: CONTEXT }),
		]
		const rows = rows_of([session('fullrun', records)])

		expect(row_of(rows, AFTER_WAIT)?.current.writes).toBe(1)
		expect(row_of(rows, OTHER)?.current.writes).toBe(1)
	})

	it('counts no write for a request that wrote nothing', () => {
		const records = [OPENING, request(1, { read: CONTEXT })]

		expect(writes_of([session('fullrun', records)], OTHER)).toBe(0)
	})

	it('sets each cause beside the period before', () => {
		const records = [request(PREVIOUS_MINUTE, { write_5m: CONTEXT })]
		const row = row_of(rows_of([session('fullrun', records)]), SESSION_START)

		expect(row?.previous.writes).toBe(1)
		expect(row?.current.writes).toBe(0)
	})
})

describe('cost_audit_cause.causes_in — the rows add up to the cache write', () => {
	const records = [
		request(0, { write_5m: CONTEXT, write_1h: CONTEXT }),
		request(1, { read: CONTEXT, write_5m: APPENDED }),
		request(20, { write_1h: CONTEXT }),
	]
	const sessions = [
		session('fullrun', records),
		session('subagent', [request(2, { write_5m: CONTEXT })], 'investigator'),
		session('resume', [request(3, { write_1h: APPENDED })]),
	]
	const rows = rows_of(sessions)
	const total = cost_audit_usage.cache_write_of(sessions.flatMap((one) => one.records))

	it('lists every cause once, in order', () => {
		expect(rows.map((row) => row.cause)).toStrictEqual([...cost_audit_cause.CAUSES])
	})

	it('puts a write on every cause in the fixture', () => {
		expect(rows.every((row) => row.current.writes > 0)).toBe(true)
	})

	it('adds up to the cache write in tokens and dollars', () => {
		const tokens = rows.map((row) => row.current.write.tokens_5m + row.current.write.tokens_1h)
		const usd = rows.map((row) => cost_audit_cause.usd_of(row.current))

		expect(tokens.reduce((sum, value) => sum + value, 0)).toBe(total.tokens_5m + total.tokens_1h)
		expect(usd.reduce((sum, value) => sum + value, 0)).toBeCloseTo(total.usd_5m + total.usd_1h)
	})
})

describe('cost_audit_cause.causes_in — the 1h write at the 5m rate', () => {
	it('prices the 1h tokens at the 5m write rate beside their 1h dollars', () => {
		const rows = rows_of([session('fullrun', [request(0, { write_1h: MILLION })])])
		const figures = row_of(rows, SESSION_START)?.current

		expect(figures?.write.usd_1h).toBeCloseTo(USD_1H_PER_MILLION)
		expect(figures?.usd_1h_at_5m).toBeCloseTo(USD_5M_PER_MILLION)
	})
})
