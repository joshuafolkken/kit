import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STABLE_READS, wait_for_pr_success } from './git-pr-checks'
import { describe_pr_failure, evaluate_pr_state } from './git-pr-checks-eval'
import { CODE_RABBIT, make_pr_snapshot, PASSING_ROLLUP, SONAR_QUBE } from './git-pr-checks-fixture'
import { parse_pr_state_snapshot, type PrStateSnapshot } from './git-pr-checks-parse'

// joshuafolkken/kit#990. `E2E`, `Checks` and `Security Audit` are not on the required list, so a
// failure in any of them used to decide nothing: GitHub reports the pull request `UNSTABLE` rather
// than failed, `evaluate_pr_state` answered `pending`, and `followup` polled out its whole
// 32-minute budget before ending in `Timed out while waiting for PR checks to complete.` — a message
// naming neither the job nor the cause. Every assertion here is about *when* and *how* the wait
// ends.
//
// **The gate was never weak, and this must not make it looser.** The run never reached `success`, so
// nothing merged. The two `success` assertions below are therefore as load-bearing as the failure
// ones: they pin that the speed was not bought by opening a path a failing check could take —
// kit#753's CodeRabbit escape hatch and kit#902's E2E gate both still hold.
const E2E = 'E2E'
const CHECKS = 'Checks'
const UNSTABLE = 'UNSTABLE'
// What GitHub reports while a check is still running: not CLEAN, so nothing is mergeable yet.
const UNKNOWN = 'UNKNOWN'
const DIRTY = 'DIRTY'
const BLOCKED = 'BLOCKED'
const CHANGES_REQUESTED = 'CHANGES_REQUESTED'
const REQUIRED_CHECKS_ENV_VAR = 'JOSH_REQUIRED_CHECKS'
const REVIEW_FAILURE_MESSAGE = 'PR checks failed (review requested changes).'

function failing_snapshot(names: ReadonlyArray<string>): PrStateSnapshot {
	return make_pr_snapshot({
		merge_state_status: UNSTABLE,
		rollup: [...PASSING_ROLLUP, ...names.map((name) => ({ name, status: 'fail' }))],
	})
}

describe('evaluate_pr_state — a failing non-required check ends the wait (#990)', () => {
	it('returns failure for a failing non-required check', () => {
		expect(evaluate_pr_state(failing_snapshot([E2E]))).toBe('failure')
	})

	// The merge state resolves to UNSTABLE only once the job completes; a snapshot read while it is
	// still settling reports UNKNOWN. The verdict must not depend on which of the two arrived.
	it('returns failure before the merge state has resolved', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: UNKNOWN,
			rollup: [...PASSING_ROLLUP, { name: E2E, status: 'fail' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})
})

// joshuafolkken/kit#1232. `DIRTY` is not CLEAN, so it answered `pending` and the wait ran its whole
// budget out on a state only a rebase resolves. It is also where the conflict diagnosis that
// `pnpm josh git` used to carry landed when that command stopped waiting for the checks, so these
// assertions are what keeps a conflicting pull request from becoming a 32-minute timeout.
describe('evaluate_pr_state — a conflicting pull request ends the wait (#1232)', () => {
	it('returns failure when the merge state is DIRTY', () => {
		expect(evaluate_pr_state(make_pr_snapshot({ merge_state_status: DIRTY }))).toBe('failure')
	})

	it('names the conflict in the failure message', () => {
		const snapshot = make_pr_snapshot({ merge_state_status: DIRTY })

		expect(describe_pr_failure(snapshot)).toContain('merge conflict')
	})

	it('fails on the conflict even while a required check is still pending', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: DIRTY,
			rollup: [
				{ name: CODE_RABBIT, status: 'pending' },
				{ name: SONAR_QUBE, status: 'pending' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})

	// The state GitHub reports while a required check is merely queued, which is every healthy pull
	// request for its first seconds. Reading it as a conflict is what made the old post-watch reader
	// unusable at the point `pnpm josh git` now returns.
	it('leaves BLOCKED pending rather than reading it as a conflict', () => {
		expect(evaluate_pr_state(make_pr_snapshot({ merge_state_status: BLOCKED }))).toBe('pending')
	})
})

// The required list is pinned to its default for the two positive assertions here. `REQUIRED_CHECKS`
// is resolved from `JOSH_REQUIRED_CHECKS` at module load — a documented override — so a developer who
// has it set would otherwise see them fail on their machine and nowhere else, which is why the
// evaluator is imported lazily inside each test. `git-pr-checks-e2e-gate.test.ts` guards its own
// positive assertion the same way.
describe('evaluate_pr_state — what the fast fail must not reach (#990)', () => {
	beforeEach(() => {
		vi.resetModules()
		vi.stubEnv(REQUIRED_CHECKS_ENV_VAR, SONAR_QUBE)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	// kit#753 has CodeRabbit non-blocking end to end, so its own failure still has to leave the gate
	// exactly where it was. This is the one check whose red is allowed.
	it('leaves a CodeRabbit-only failure passing', async () => {
		const { evaluate_pr_state: evaluate } = await import('./git-pr-checks-eval')
		const snapshot = make_pr_snapshot({
			merge_state_status: UNSTABLE,
			rollup: [
				{ name: `${CODE_RABBIT} / Review`, status: 'fail' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate(snapshot)).toBe('success')
	})

	// A job whose `if:` condition was false is COMPLETED/SKIPPED, which the parser reads as passing —
	// so the fast fail never sees it. Asserted from a raw payload because the claim spans the parser
	// and the evaluator, and because a conditional job must not read as a failed one.
	it('does not treat a skipped conditional job as a failure', async () => {
		const { evaluate_pr_state: evaluate } = await import('./git-pr-checks-eval')
		const raw = JSON.stringify({
			mergeStateStatus: UNSTABLE,
			reviewDecision: 'APPROVED',
			statusCheckRollup: [
				// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
				{ __typename: 'CheckRun', name: E2E, status: 'COMPLETED', conclusion: 'SKIPPED' },
				// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
				{ __typename: 'CheckRun', name: SONAR_QUBE, status: 'COMPLETED', conclusion: 'SUCCESS' },
				// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field name
				{ __typename: 'StatusContext', context: CODE_RABBIT, state: 'PENDING' },
			],
		})

		expect(evaluate(parse_pr_state_snapshot(raw))).toBe('success')
	})
})

// The other half of the acceptance criteria: a red run has to say what to open. The old text named
// no check at all, so the only way to find the cause was the pull request page.
describe('describe_pr_failure', () => {
	it('names every failing check', () => {
		expect(describe_pr_failure(failing_snapshot([E2E, CHECKS]))).toBe(
			`PR checks failed (failed checks: ${E2E}, ${CHECKS}).`,
		)
	})

	it('reports a requested-changes review without naming a check', () => {
		const snapshot = make_pr_snapshot({ review_decision: CHANGES_REQUESTED })

		expect(describe_pr_failure(snapshot)).toBe(REVIEW_FAILURE_MESSAGE)
	})

	it('reports both causes when they coincide', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: UNSTABLE,
			review_decision: CHANGES_REQUESTED,
			rollup: [...PASSING_ROLLUP, { name: E2E, status: 'fail' }],
		})

		expect(describe_pr_failure(snapshot)).toBe(
			`PR checks failed (review requested changes; failed checks: ${E2E}).`,
		)
	})

	// The kit#753 exemption reaches the message too: a CodeRabbit failure is not what stopped the
	// run, so naming it would point the reader at the one check that was allowed to be red.
	it('omits a non-required CodeRabbit failure', () => {
		const snapshot = make_pr_snapshot({
			merge_state_status: UNSTABLE,
			review_decision: CHANGES_REQUESTED,
			rollup: [
				{ name: CODE_RABBIT, status: 'fail' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(describe_pr_failure(snapshot)).toBe(REVIEW_FAILURE_MESSAGE)
	})
})

// End to end through the poll loop: the behavior the issue is actually about is how long `followup`
// takes to come back, so the count of fetches is part of the assertion rather than an aside.
describe('wait_for_pr_success — a failing non-required check (#990)', () => {
	it('stops on the first poll and names the failing check', async () => {
		let fetch_count = 0

		async function fetcher(): Promise<PrStateSnapshot> {
			fetch_count += 1

			return failing_snapshot([E2E])
		}

		await expect(
			wait_for_pr_success({
				branch_name: 'feature/x',
				fetcher,
				interval_ms: 0,
				max_attempts: 5,
				required_stable_reads: DEFAULT_STABLE_READS,
			}),
		).rejects.toThrow(`PR checks failed (failed checks: ${E2E}).`)

		expect(fetch_count).toBe(1)
	})
})
