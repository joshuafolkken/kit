import { describe, expect, it } from 'vitest'
import { evaluate_pr_state } from './git-pr-checks-eval'
import type { PrStateSnapshot, RollupCheck } from './git-pr-checks-parse'

// joshuafolkken/kit#4351: GitHub reports UNSTABLE while an optional check — default-setup `CodeQL`,
// about thirty minutes beside a six-minute CI — is still running. The merge gate proceeds once
// every check the base branch's rules require has passed, and stays strict where none are known.

const REQUIRED_CONTEXTS = ['Checks', 'SonarQube']
const CHECKS_PASSED: RollupCheck = { name: 'Checks', status: 'pass' }
const SONAR_PASSED: RollupCheck = { name: 'SonarQube', status: 'pass' }
const CODEQL_RUNNING: RollupCheck = { name: 'CodeQL', status: 'pending' }

function unstable(
	rollup: Array<RollupCheck>,
	required_contexts: Array<string> = REQUIRED_CONTEXTS,
): PrStateSnapshot {
	return {
		rollup,
		merge_state_status: 'UNSTABLE',
		review_decision: undefined,
		required_contexts,
	}
}

describe('evaluate_pr_state — an optional check still running', () => {
	it('returns success when every required context passed and only an optional check runs', () => {
		const snapshot = unstable([CHECKS_PASSED, SONAR_PASSED, CODEQL_RUNNING])

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	it('returns success when the required context passed as a nested suite job', () => {
		const snapshot = unstable([
			{ name: 'Checks / lint', status: 'pass' },
			SONAR_PASSED,
			CODEQL_RUNNING,
		])

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	it('returns failure when an optional check has failed', () => {
		const snapshot = unstable([CHECKS_PASSED, SONAR_PASSED, { name: 'CodeQL', status: 'fail' }])

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})
})

describe('evaluate_pr_state — the gate stays strict', () => {
	it('returns pending while a required context is still running', () => {
		const snapshot = unstable([{ name: 'Checks', status: 'pending' }, SONAR_PASSED, CODEQL_RUNNING])

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('returns pending while a required context has not reported', () => {
		const snapshot = unstable([SONAR_PASSED, CODEQL_RUNNING])

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('returns pending when no required context is known', () => {
		const snapshot: PrStateSnapshot = {
			rollup: [CHECKS_PASSED, SONAR_PASSED, CODEQL_RUNNING],
			merge_state_status: 'UNSTABLE',
			review_decision: undefined,
		}

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('returns pending on BLOCKED however the rollup reads', () => {
		const snapshot = {
			...unstable([CHECKS_PASSED, SONAR_PASSED, CODEQL_RUNNING]),
			merge_state_status: 'BLOCKED',
		}

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})
})
