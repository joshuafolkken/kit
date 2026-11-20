import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_session_count } from './cost-audit-session-count'

const { record, session } = cost_audit_fixture

describe('cost_audit_session_count.counts_by_kind', () => {
	it('counts the sessions of each kind that hold a request, and none without one', () => {
		const sessions = [
			session('handoff', [record('a', 1, 1)]),
			session('handoff', [record('b', 2, 1), record('c', 3, 1)]),
			session('wake', []),
		]

		expect(cost_audit_session_count.counts_by_kind(sessions)).toStrictEqual(
			new Map([['handoff', 2]]),
		)
	})
})

describe('cost_audit_session_count.row_text', () => {
	it('prints the session counts and each period’s dollars per session', () => {
		const text = cost_audit_session_count.row_text(
			{ current: 9, previous: 4 },
			{ current: 3, previous: 4 },
		)

		expect(text).toBe(' · 3 session(s) (prev 4) · $3.0000 per session (prev $1.0000)')
	})

	it('prints no dollars per session when a period has no session', () => {
		const text = cost_audit_session_count.row_text(
			{ current: 9, previous: 0 },
			{ current: 3, previous: 0 },
		)

		expect(text).toBe(' · 3 session(s) (prev 0)')
	})

	it('prints nothing for a row that carries no session counts', () => {
		expect(cost_audit_session_count.row_text({ current: 9, previous: 4 }, undefined)).toBe('')
	})
})
