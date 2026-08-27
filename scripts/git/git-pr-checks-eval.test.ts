import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluate_pr_state, read_required_statuses, REQUIRED_CHECKS } from './git-pr-checks-eval'
import { CODE_RABBIT, make_pr_snapshot, PASSING_ROLLUP, SONAR_QUBE } from './git-pr-checks-fixture'
import { parse_pr_state_snapshot, type RollupCheck } from './git-pr-checks-parse'

const LIGHTHOUSE = 'Lighthouse'

describe('REQUIRED_CHECKS', () => {
	it('excludes CodeRabbit while the temporary kit#753 policy is active', () => {
		expect(REQUIRED_CHECKS).not.toContain(CODE_RABBIT)
	})

	it('includes SonarQube', () => {
		expect(REQUIRED_CHECKS).toContain(SONAR_QUBE)
	})
})

describe('read_required_statuses', () => {
	it('returns pass for all required checks when all are present and passing', () => {
		const statuses = read_required_statuses([...PASSING_ROLLUP])

		expect(statuses).toHaveLength(REQUIRED_CHECKS.length)
		expect(statuses.every((status) => status === 'pass')).toBe(true)
	})

	it('returns missing for a required check not in the rollup', () => {
		const statuses = read_required_statuses([{ name: CODE_RABBIT, status: 'pass' }])

		expect(statuses).toContain('missing')
	})

	it('returns the actual status for a pending required check', () => {
		const checks: Array<RollupCheck> = [
			{ name: CODE_RABBIT, status: 'pass' },
			{ name: SONAR_QUBE, status: 'pending' },
		]
		const statuses = read_required_statuses(checks)

		expect(statuses).toContain('pending')
	})

	it('ignores non-required checks', () => {
		const checks: Array<RollupCheck> = [...PASSING_ROLLUP, { name: LIGHTHOUSE, status: 'fail' }]
		const statuses = read_required_statuses(checks)

		expect(statuses.every((status) => status === 'pass')).toBe(true)
	})
})

describe('read_required_statuses — check-suite prefix matching', () => {
	it('matches a check-suite job nested under the required app name', () => {
		const checks: Array<RollupCheck> = [{ name: `${SONAR_QUBE} / Gate`, status: 'pass' }]
		const statuses = read_required_statuses(checks)

		expect(statuses.every((status) => status === 'pass')).toBe(true)
	})

	it('does not match a context that merely starts with the required name', () => {
		const checks: Array<RollupCheck> = [{ name: `${SONAR_QUBE}Nightly`, status: 'pass' }]
		const statuses = read_required_statuses(checks)

		expect(statuses).toContain('missing')
	})
})

describe('evaluate_pr_state — success', () => {
	it('returns success when CLEAN and all required checks pass', () => {
		expect(evaluate_pr_state(make_pr_snapshot())).toBe('success')
	})

	it('returns success when non-required check is pending', () => {
		const snapshot = make_pr_snapshot({
			rollup: [...PASSING_ROLLUP, { name: LIGHTHOUSE, status: 'pending' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	it('returns success when SonarQube is present only as its renamed suite job', () => {
		const snapshot = make_pr_snapshot({
			rollup: [{ name: `${SONAR_QUBE} / Gate`, status: 'pass' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('evaluate_pr_state — temporary CodeRabbit skip (kit#753)', () => {
	it('returns success when UNSTABLE is caused only by a pending CodeRabbit check', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: 'UNSTABLE',
			rollup: [
				{ name: CODE_RABBIT, status: 'pending' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	it('returns success when UNSTABLE is caused only by a failing CodeRabbit suite job', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: 'UNSTABLE',
			rollup: [
				{ name: `${CODE_RABBIT} / Review`, status: 'fail' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('evaluate_pr_state — UNSTABLE not attributable to CodeRabbit', () => {
	it('returns pending when UNSTABLE has no non-passing checks to attribute', () => {
		const snapshot = make_pr_snapshot({ merge_state_status: 'UNSTABLE' })

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('returns pending when the only non-passing non-CodeRabbit check is still running', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: 'UNSTABLE',
			rollup: [...PASSING_ROLLUP, { name: LIGHTHOUSE, status: 'pending' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})
})

describe('evaluate_pr_state — failure', () => {
	it('returns failure when a required check has failed', () => {
		const snapshot = make_pr_snapshot({
			rollup: [
				{ name: CODE_RABBIT, status: 'pass' },
				{ name: SONAR_QUBE, status: 'fail' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})

	it('returns failure when review decision is CHANGES_REQUESTED', () => {
		expect(evaluate_pr_state(make_pr_snapshot({ review_decision: 'CHANGES_REQUESTED' }))).toBe(
			'failure',
		)
	})
})

describe('evaluate_pr_state — pending', () => {
	it('returns pending when merge state is not CLEAN', () => {
		expect(evaluate_pr_state(make_pr_snapshot({ merge_state_status: 'UNKNOWN' }))).toBe('pending')
	})

	it('returns pending when a required check is still pending', () => {
		const snapshot = make_pr_snapshot({
			rollup: [
				{ name: CODE_RABBIT, status: 'pass' },
				{ name: SONAR_QUBE, status: 'pending' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('returns pending when a required check is missing', () => {
		const snapshot = make_pr_snapshot({
			rollup: [{ name: CODE_RABBIT, status: 'pass' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})
})

function skipped_job(name: string): Record<string, string> {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
	return { __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SKIPPED' }
}

// Regression guard for #793, written against a raw payload rather than hand-built RollupChecks
// because the defect lived in the seam between the two modules: the parser recorded GitHub's
// SKIPPED conclusion as a failure, so the kit#753 escape hatch saw non-CodeRabbit entries in the
// non-passing set and left the merge gate waiting until it timed out. This is the shape of PR #792,
// whose only outstanding check was a slow CodeRabbit review.
describe('evaluate_pr_state — parsed payload with skipped jobs (#793)', () => {
	const raw = JSON.stringify({
		mergeStateStatus: 'UNSTABLE',
		reviewDecision: 'APPROVED',
		statusCheckRollup: [
			skipped_job('auto-merge'),
			skipped_job('E2E'),
			skipped_job('Notify Auto Tag'),
			// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
			{ __typename: 'CheckRun', name: SONAR_QUBE, status: 'COMPLETED', conclusion: 'SUCCESS' },
			// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
			{ __typename: 'StatusContext', context: CODE_RABBIT, state: 'PENDING' },
		],
	})

	it('reads every skipped job as passing', () => {
		const snapshot = parse_pr_state_snapshot(raw)
		const non_passing = snapshot.rollup.filter((check) => check.status !== 'pass')

		expect(non_passing).toStrictEqual([{ name: CODE_RABBIT, status: 'pending' }])
	})

	it('opens the merge gate when the pending CodeRabbit review is all that remains', () => {
		expect(evaluate_pr_state(parse_pr_state_snapshot(raw))).toBe('success')
	})
})

const JOSH_REQUIRED_CHECKS = 'JOSH_REQUIRED_CHECKS'
const CUSTOM_CHECKS = 'Lighthouse,DeployCheck'

describe('REQUIRED_CHECKS — JOSH_REQUIRED_CHECKS env var override', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.stubEnv(JOSH_REQUIRED_CHECKS, CUSTOM_CHECKS)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('uses env var checks instead of defaults', async () => {
		const { REQUIRED_CHECKS: checks } = await import('./git-pr-checks-eval')

		expect(checks).toContain(LIGHTHOUSE)
		expect(checks).toContain('DeployCheck')
		expect(checks).not.toContain(CODE_RABBIT)
	})
})

describe('REQUIRED_CHECKS — JOSH_REQUIRED_CHECKS env var not set', () => {
	beforeEach(() => {
		vi.resetModules()
	})

	it('falls back to defaults when env var is absent', async () => {
		const { REQUIRED_CHECKS: checks } = await import('./git-pr-checks-eval')

		expect(checks).not.toContain(CODE_RABBIT)
		expect(checks).toContain(SONAR_QUBE)
	})
})
