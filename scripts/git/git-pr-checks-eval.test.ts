import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluate_pr_state, read_required_statuses, REQUIRED_CHECKS } from './git-pr-checks-eval'
import type { PrStateSnapshot, RollupCheck } from './git-pr-checks-parse'

const CODE_RABBIT = 'CodeRabbit'
const SONAR_QUBE = 'SonarQube'

const PASSING_ROLLUP: ReadonlyArray<RollupCheck> = [
	{ name: CODE_RABBIT, status: 'pass' },
	{ name: SONAR_QUBE, status: 'pass' },
]

function make_snapshot(overrides: Partial<PrStateSnapshot> = {}): PrStateSnapshot {
	return {
		rollup: [...PASSING_ROLLUP],
		merge_state_status: 'CLEAN',
		review_decision: 'APPROVED',
		...overrides,
	}
}

describe('REQUIRED_CHECKS', () => {
	it('includes CodeRabbit', () => {
		expect(REQUIRED_CHECKS).toContain(CODE_RABBIT)
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
			{ name: CODE_RABBIT, status: 'pending' },
			{ name: SONAR_QUBE, status: 'pass' },
		]
		const statuses = read_required_statuses(checks)

		expect(statuses).toContain('pending')
		expect(statuses).toContain('pass')
	})

	it('ignores non-required checks', () => {
		const checks: Array<RollupCheck> = [...PASSING_ROLLUP, { name: 'Lighthouse', status: 'fail' }]
		const statuses = read_required_statuses(checks)

		expect(statuses.every((status) => status === 'pass')).toBe(true)
	})
})

describe('evaluate_pr_state — success', () => {
	it('returns success when CLEAN and all required checks pass', () => {
		expect(evaluate_pr_state(make_snapshot())).toBe('success')
	})

	it('returns success when non-required check is pending', () => {
		const snapshot = make_snapshot({
			rollup: [...PASSING_ROLLUP, { name: 'Lighthouse', status: 'pending' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('evaluate_pr_state — failure', () => {
	it('returns failure when a required check has failed', () => {
		const snapshot = make_snapshot({
			rollup: [
				{ name: CODE_RABBIT, status: 'fail' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})

	it('returns failure when review decision is CHANGES_REQUESTED', () => {
		expect(evaluate_pr_state(make_snapshot({ review_decision: 'CHANGES_REQUESTED' }))).toBe(
			'failure',
		)
	})
})

describe('evaluate_pr_state — pending', () => {
	it('returns pending when merge state is not CLEAN', () => {
		expect(evaluate_pr_state(make_snapshot({ merge_state_status: 'UNKNOWN' }))).toBe('pending')
	})

	it('returns pending when a required check is still pending', () => {
		const snapshot = make_snapshot({
			rollup: [
				{ name: CODE_RABBIT, status: 'pending' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('returns pending when a required check is missing', () => {
		const snapshot = make_snapshot({
			rollup: [{ name: CODE_RABBIT, status: 'pass' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
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

		expect(checks).toContain('Lighthouse')
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

		expect(checks).toContain(CODE_RABBIT)
		expect(checks).toContain(SONAR_QUBE)
	})
})
