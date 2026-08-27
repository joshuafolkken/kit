import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluate_pr_state } from './git-pr-checks-eval'
import {
	parse_pr_state_snapshot,
	type PrStateSnapshot,
	type RollupCheck,
} from './git-pr-checks-parse'

// joshuafolkken/kit#902 removed the completion gate's human E2E run: nobody is asked to run
// `pnpm josh test` and paste the output any more. That leaves the CI E2E job as the only E2E signal
// a `fullrun` reads, so what used to be an implementation detail of the wait loop is now the
// verification itself — these are the assertions that removing the human step did not open the
// gate. The claim they pin is written out in `prompts/testing-guide.md` → "Closing the E2E gate
// without a human run" → "The gate is not weakened".
//
// **Two separate mechanisms hold the gate closed, and each fixture below picks one.** `E2E` is
// deliberately not in `DEFAULT_REQUIRED_CHECKS`. A *failed* E2E job is caught by
// `collect_blocking_failures` since joshuafolkken/kit#990, which short-circuits `evaluate_pr_state`
// before the merge state is consulted at all. A *non-passing but not failed* one — still running, or
// pending beside a pending CodeRabbit review — reaches GitHub's `mergeStateStatus` instead, and
// `is_mergeable_state` demands `CLEAN`. Both paths are exercised on purpose: the fast fail must not
// become the only thing standing between a red E2E and a merge. Every fixture states its merge state
// explicitly rather than defaulting it — that string is the mechanism under test for the second
// path, not scaffolding. Whether `E2E` should also be a required check is joshuafolkken/kit#991.
const E2E_CHECK = 'E2E'
const CODE_RABBIT = 'CodeRabbit'
const SONAR_QUBE = 'SonarQube'
const UNSTABLE = 'UNSTABLE'
// What GitHub reports while a check is still running: not CLEAN, so the gate stays closed.
const UNKNOWN = 'UNKNOWN'
const SUCCESS = 'success'
const REQUIRED_CHECKS_ENV_VAR = 'JOSH_REQUIRED_CHECKS'

// The merge state is passed in rather than fixed, because GitHub reports the two cases differently:
// a *completed* non-required failure gives UNSTABLE, while a job still running leaves the state
// unresolved. Fixing it at UNSTABLE for both would exercise the failed-job path twice and let the
// pending path regress unnoticed.
function snapshot_with_e2e(input: {
	e2e_status: string
	merge_state_status: string
	others: ReadonlyArray<RollupCheck>
}): PrStateSnapshot {
	return {
		rollup: [...input.others, { name: E2E_CHECK, status: input.e2e_status }],
		merge_state_status: input.merge_state_status,
		review_decision: 'APPROVED',
	}
}

describe('a non-passing E2E job keeps the merge closed', () => {
	it.each([
		{ e2e_status: 'fail', merge_state_status: UNSTABLE },
		{ e2e_status: 'pending', merge_state_status: UNKNOWN },
	])('never reaches success while the E2E check is $e2e_status', (state) => {
		const snapshot = snapshot_with_e2e({
			...state,
			others: [
				{ name: CODE_RABBIT, status: 'pass' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).not.toBe(SUCCESS)
	})

	// The one opening in the wall is the temporary kit#753 CodeRabbit skip, and it applies only when
	// *every* non-passing check is CodeRabbit's. An E2E job that is not passing beside a pending
	// review must not be swept through it — that would be the exact weakening the removed human step
	// used to catch. Both statuses are asserted because they take different routes: `fail` is caught
	// by the kit#990 fast fail before the exemption is reached, while `pending` is what actually puts
	// the exemption to the test.
	it.each([{ e2e_status: 'fail' }, { e2e_status: 'pending' }])(
		'is not swept through the temporary CodeRabbit exemption while E2E is $e2e_status',
		(state) => {
			const snapshot = snapshot_with_e2e({
				...state,
				merge_state_status: UNSTABLE,
				others: [
					{ name: CODE_RABBIT, status: 'pending' },
					{ name: SONAR_QUBE, status: 'pass' },
				],
			})

			expect(evaluate_pr_state(snapshot)).not.toBe(SUCCESS)
		},
	)
})

// The defined behavior for a project with no E2E suite: `e2e-detect` leaves the job's `if:` false,
// GitHub records it as COMPLETED/SKIPPED, and the rollup parser counts that as passing. Asserted
// from a raw payload because the claim spans the parser and the evaluator, and because "no suite"
// must read as a pass rather than as something the gate waits out.
//
// The required list is pinned to its default for this one case. `REQUIRED_CHECKS` is resolved from
// `JOSH_REQUIRED_CHECKS` at module load — a documented override — so a developer who has it set
// would otherwise see this positive assertion fail on their machine and nowhere else.
describe('a skipped E2E job is a defined pass, not a stalled gate', () => {
	const raw = JSON.stringify({
		mergeStateStatus: 'CLEAN',
		reviewDecision: 'APPROVED',
		statusCheckRollup: [
			// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
			{ __typename: 'CheckRun', name: E2E_CHECK, status: 'COMPLETED', conclusion: 'SKIPPED' },
			// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
			{ __typename: 'CheckRun', name: SONAR_QUBE, status: 'COMPLETED', conclusion: 'SUCCESS' },
		],
	})

	beforeEach(() => {
		vi.resetModules()
		vi.stubEnv(REQUIRED_CHECKS_ENV_VAR, SONAR_QUBE)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('reads the skipped job as passing', () => {
		const e2e = parse_pr_state_snapshot(raw).rollup.find((check) => check.name === E2E_CHECK)

		expect(e2e?.status).toBe('pass')
	})

	it('opens the merge gate', async () => {
		const { evaluate_pr_state: evaluate } = await import('./git-pr-checks-eval')

		expect(evaluate(parse_pr_state_snapshot(raw))).toBe(SUCCESS)
	})
})
