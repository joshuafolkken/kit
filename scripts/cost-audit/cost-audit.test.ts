import { guard_friction_fixture } from '#scripts/retrospective/guard-friction-fixture'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { describe, expect, it } from 'vitest'
import { cost_audit, type Audit, type AuditRow, type MergeCounts } from './cost-audit'
import { cost_audit_fixture } from './cost-audit-fixture'

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

describe('cost_audit.audit — the floor keeps cent-sized growth out of the regressions', () => {
	it('does not flag a row under the floor however much it grew', () => {
		const sessions = [session('fullrun', [record('a', PREVIOUS, 0.1), record('b', CURRENT, 0.5)])]
		const result = cost_audit.audit({ sessions, days: DAYS, now_ms: NOW_MS, merges: undefined })

		expect(result.total.is_regression).toBe(false)
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
