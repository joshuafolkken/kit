import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describe_pr_failure, evaluate_pr_state } from './git-pr-checks-eval'
import { make_pr_snapshot, PASSING_ROLLUP, SONAR_QUBE } from './git-pr-checks-fixture'
import {
	collect_missing_contexts,
	forget_missing_contexts,
	MISSING_GRACE_MS,
} from './git-pr-checks-missing'

// joshuafolkken/kit#5774: a partial rerun dropped the required `Checks` job from its run's latest
// attempt, and the wait read the BLOCKED pull request as `pending` for its whole 32-minute budget.

const CHECKS = 'Checks'
const BLOCKED = 'BLOCKED'
const NAMED_FAILURE = 'PR checks failed (required context Checks has no check-run).'
const PENDING_ROLLUP = [...PASSING_ROLLUP, { name: 'Unit Tests', status: 'pending' }]

type Snapshot = ReturnType<typeof make_pr_snapshot>

function missing_checks_snapshot(overrides: Parameters<typeof make_pr_snapshot>[0] = {}): Snapshot {
	return make_pr_snapshot({
		merge_state_status: BLOCKED,
		required_contexts: [CHECKS, SONAR_QUBE],
		...overrides,
	})
}

function read_after_grace(snapshot: Snapshot): Array<string> {
	collect_missing_contexts(snapshot)
	vi.advanceTimersByTime(MISSING_GRACE_MS)

	return collect_missing_contexts(snapshot)
}

beforeEach(() => {
	forget_missing_contexts()
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('collect_missing_contexts — grace window', () => {
	it('names nothing on the first settled read without the context', () => {
		expect(collect_missing_contexts(missing_checks_snapshot())).toStrictEqual([])
	})

	it('names a required context still absent once the grace window has passed', () => {
		expect(read_after_grace(missing_checks_snapshot())).toStrictEqual([CHECKS])
	})

	it.each([
		['pending', 'pending'],
		['passed', 'pass'],
	])('names nothing when the context registers %s after an absent read', (_label, status) => {
		const registered = missing_checks_snapshot({
			rollup: [...PASSING_ROLLUP, { name: CHECKS, status }],
		})

		collect_missing_contexts(missing_checks_snapshot())
		vi.advanceTimersByTime(MISSING_GRACE_MS)

		expect(collect_missing_contexts(registered)).toStrictEqual([])
	})

	it('restarts the grace window after a read with a check pending', () => {
		collect_missing_contexts(missing_checks_snapshot())
		vi.advanceTimersByTime(MISSING_GRACE_MS)
		collect_missing_contexts(missing_checks_snapshot({ rollup: PENDING_ROLLUP }))

		expect(collect_missing_contexts(missing_checks_snapshot())).toStrictEqual([])
		vi.advanceTimersByTime(MISSING_GRACE_MS)
		expect(collect_missing_contexts(missing_checks_snapshot())).toStrictEqual([CHECKS])
	})

	it('restarts the grace window on a new head', () => {
		collect_missing_contexts(missing_checks_snapshot({ head_sha: 'aaa' }))
		vi.advanceTimersByTime(MISSING_GRACE_MS)

		expect(collect_missing_contexts(missing_checks_snapshot({ head_sha: 'bbb' }))).toStrictEqual([])
	})
})

describe('collect_missing_contexts — when nothing is missing', () => {
	it('names nothing while a check is still pending', () => {
		expect(read_after_grace(missing_checks_snapshot({ rollup: PENDING_ROLLUP }))).toStrictEqual([])
	})

	it('names nothing on a CLEAN pull request', () => {
		const snapshot = missing_checks_snapshot({ merge_state_status: 'CLEAN' })

		expect(read_after_grace(snapshot)).toStrictEqual([])
	})

	it('names nothing when the base branch rules are unknown', () => {
		expect(read_after_grace(make_pr_snapshot({ merge_state_status: BLOCKED }))).toStrictEqual([])
	})

	it('names nothing before any check has reported', () => {
		expect(read_after_grace(missing_checks_snapshot({ rollup: [] }))).toStrictEqual([])
	})

	it('reads a check-suite job as its required context', () => {
		const rollup = [...PASSING_ROLLUP, { name: `${CHECKS} / build`, status: 'pass' }]

		expect(read_after_grace(missing_checks_snapshot({ rollup }))).toStrictEqual([])
	})
})

describe('evaluate_pr_state — a required context with no check-run', () => {
	it('fails with the context named once the gap outlasts the grace window', () => {
		const snapshot = missing_checks_snapshot()

		expect(evaluate_pr_state(snapshot)).toBe('pending')
		vi.advanceTimersByTime(MISSING_GRACE_MS)
		expect(evaluate_pr_state(snapshot)).toBe('failure')
		expect(describe_pr_failure(snapshot)).toBe(NAMED_FAILURE)
	})

	it('keeps waiting while the context may still register', () => {
		expect(evaluate_pr_state(missing_checks_snapshot({ rollup: PENDING_ROLLUP }))).toBe('pending')
	})
})
