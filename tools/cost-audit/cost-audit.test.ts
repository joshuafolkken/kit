import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { guard_friction_fixture } from '#tools/retrospective/guard-friction-fixture'
import { describe, expect, it } from 'vitest'
import { cost_audit, type Audit, type AuditRow, type MergeCounts } from './cost-audit'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_spend } from './cost-audit-spend'

const { ms, day, record, session } = cost_audit_fixture

// A one-day period ending at day 2: the current period is day 1, the previous one day 0.
const DAYS = 1
const NOW_MS = ms(day(2))
const PREVIOUS = day(0) + 1
const CURRENT = day(1) + 1

function key_of(rows: ReadonlyArray<AuditRow>, key: string): AuditRow | undefined {
	return rows.find((row) => row.key === key)
}

const SESSIONS = [
	session(
		'fullrun',
		[record('a', PREVIOUS, 2), record('b', CURRENT, 4)],
		[['b', ['edit', 'doc read']]],
	),
	session('review', [record('c', PREVIOUS, 2), record('d', CURRENT, 2)]),
	session('wake', [record('old', day(-1), 9)]),
]

function audit_of(merges: MergeCounts | undefined): Audit {
	return cost_audit.audit({ sessions: SESSIONS, days: DAYS, now_ms: NOW_MS, merges })
}

describe('cost_audit.audit — the period set against the one before it', () => {
	const result = audit_of({ current: 2, previous: 4 })

	it('totals each period and leaves out what falls before both', () => {
		expect(result.total).toMatchObject({ current: 6, previous: 4, is_regression: true })
	})

	it('flags a session kind that grew past the threshold, and not one that held steady', () => {
		expect(key_of(result.kinds, 'fullrun')).toMatchObject({
			current: 4,
			previous: 2,
			is_regression: true,
		})
		expect(key_of(result.kinds, 'review')?.is_regression).toBe(false)
	})

	it('splits a request among its calls and files a call-free request as a reply', () => {
		expect(key_of(result.tools, 'edit')?.current).toBe(2)
		expect(key_of(result.tools, 'doc read')?.current).toBe(2)
		expect(key_of(result.tools, 'reply')).toMatchObject({ current: 2, previous: 4 })
	})

	it('divides each period by its own merge count', () => {
		expect(result.per_merge).toMatchObject({ current: 3, previous: 1, is_regression: true })
	})

	it('prints no per-merge row when the merge counts were not read', () => {
		expect(audit_of(undefined).per_merge).toBeUndefined()
	})
})

// joshuafolkken/kit#6913: each kind's current-period spend by model and token type, priced by #6899's
// breakdown, so the kinds' model terms sum to the period's total.
const OPUS = 'claude-opus-4-6'

function spent(row: AuditRow): number {
	return (row.models ?? []).reduce((sum, spend) => sum + cost_audit_spend.total_of(spend), 0)
}

describe('cost_audit.audit — the session kinds by model and token type', () => {
	const opus = { ...record('o', CURRENT, 3), model: OPUS }
	const sessions = [...SESSIONS, session('fullrun', [opus, record('p', PREVIOUS, 7)])]
	const result = cost_audit.audit({ sessions, days: DAYS, now_ms: NOW_MS, merges: undefined })

	it('sums each kind model terms to the kind current figure alone', () => {
		for (const kind of result.kinds) expect(spent(kind)).toBeCloseTo(kind.current)
	})

	it('sums every kind model terms to the current period total', () => {
		const sum = result.kinds.reduce((total, kind) => total + spent(kind), 0)

		expect(sum).toBeCloseTo(result.total.current)
	})

	it('lists each billed model of a kind, the costliest first', () => {
		const models = key_of(result.kinds, 'fullrun')?.models?.map((spend) => spend.model)

		expect(models).toStrictEqual([OPUS, 'claude-haiku-4-5'])
	})
})

describe('cost_audit.audit — the floor keeps cent-sized growth out of the regressions', () => {
	it('does not flag a row under the floor however much it grew', () => {
		const sessions = [session('fullrun', [record('a', PREVIOUS, 0.1), record('b', CURRENT, 0.5)])]
		const result = cost_audit.audit({ sessions, days: DAYS, now_ms: NOW_MS, merges: undefined })

		expect(result.total.is_regression).toBe(false)
	})
})

// joshuafolkken/kit#5971: the agent type table reads the current period alone.
describe('cost_audit.audit — the lane subagents by agent type', () => {
	it('sums only the requests inside the current period', () => {
		const records = [record('a', PREVIOUS, 5), record('b', CURRENT, 2)]
		const unit = { ...session('review', records), issue: 7, agent_type: 'reviewer' }
		const result = cost_audit.audit({
			sessions: [unit],
			days: DAYS,
			now_ms: NOW_MS,
			merges: undefined,
		})

		expect(result.agents.map((row) => [row.key, row.usd])).toStrictEqual([
			['subagent: reviewer', 2],
		])
	})
})

describe('cost_audit.audit — guards are priced by their answering round trip', () => {
	it('charges a refusal the request that answered it, in the period it fell in', () => {
		const lines = time_transcript_line.parse_text(
			guard_friction_fixture.refusal_line(CURRENT, 'x', '⛔ batching: issue these together'),
		)
		const refused = { ...session('fullrun', [record('a', CURRENT, 3)]), lines }
		const result = cost_audit.audit({
			sessions: [refused],
			days: DAYS,
			now_ms: NOW_MS,
			merges: undefined,
		})

		expect(key_of(result.guards, 'batching')).toMatchObject({ current: 3, previous: 0 })
	})
})
