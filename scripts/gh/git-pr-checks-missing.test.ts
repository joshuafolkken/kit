import { describe, expect, it } from 'vitest'
import { describe_pr_failure, evaluate_pr_state } from './git-pr-checks-eval'
import { make_pr_snapshot, PASSING_ROLLUP, SONAR_QUBE } from './git-pr-checks-fixture'
import { collect_missing_contexts } from './git-pr-checks-missing'

// joshuafolkken/kit#5774: a partial rerun dropped the required `Checks` job from its run's latest
// attempt, and the wait read the BLOCKED pull request as `pending` for its whole 32-minute budget.

const CHECKS = 'Checks'
const BLOCKED = 'BLOCKED'
const NAMED_FAILURE = 'PR checks failed (required context Checks has no check-run).'
const PENDING_ROLLUP = [...PASSING_ROLLUP, { name: 'Unit Tests', status: 'pending' }]

function missing_checks_snapshot(
	overrides: Parameters<typeof make_pr_snapshot>[0] = {},
): ReturnType<typeof make_pr_snapshot> {
	return make_pr_snapshot({
		merge_state_status: BLOCKED,
		required_contexts: [CHECKS, SONAR_QUBE],
		...overrides,
	})
}

describe('collect_missing_contexts', () => {
	it('names a required context with no check-run once every check has settled', () => {
		expect(collect_missing_contexts(missing_checks_snapshot())).toStrictEqual([CHECKS])
	})

	it('names nothing while a check is still pending', () => {
		const snapshot = missing_checks_snapshot({ rollup: PENDING_ROLLUP })

		expect(collect_missing_contexts(snapshot)).toStrictEqual([])
	})

	it('names nothing on a CLEAN pull request', () => {
		const snapshot = missing_checks_snapshot({ merge_state_status: 'CLEAN' })

		expect(collect_missing_contexts(snapshot)).toStrictEqual([])
	})

	it('names nothing when the base branch rules are unknown', () => {
		const snapshot = make_pr_snapshot({ merge_state_status: BLOCKED })

		expect(collect_missing_contexts(snapshot)).toStrictEqual([])
	})

	it('names nothing before any check has reported', () => {
		expect(collect_missing_contexts(missing_checks_snapshot({ rollup: [] }))).toStrictEqual([])
	})

	it('reads a check-suite job as its required context', () => {
		const rollup = [...PASSING_ROLLUP, { name: `${CHECKS} / build`, status: 'pass' }]

		expect(collect_missing_contexts(missing_checks_snapshot({ rollup }))).toStrictEqual([])
	})
})

describe('evaluate_pr_state — a required context with no check-run', () => {
	it('fails at once with the context named instead of waiting', () => {
		const snapshot = missing_checks_snapshot()

		expect(evaluate_pr_state(snapshot)).toBe('failure')
		expect(describe_pr_failure(snapshot)).toBe(NAMED_FAILURE)
	})

	it('keeps waiting while the context may still register', () => {
		expect(evaluate_pr_state(missing_checks_snapshot({ rollup: PENDING_ROLLUP }))).toBe('pending')
	})
})
