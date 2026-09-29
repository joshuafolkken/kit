import { describe, expect, it } from 'vitest'
import { check_runs_pages, status_pages } from './git-gh-pr-fixture'
import { to_status_check_rollup } from './git-gh-pr-rollup'
import { MERGE_GATE_EVALUATOR, wait_for_pr_success, type PrStateEvaluator } from './git-pr-checks'
import { describe_pr_failure, evaluate_pr_state } from './git-pr-checks-eval'
import { make_pr_snapshot } from './git-pr-checks-fixture'
import { parse_pr_state_snapshot, type PrStateSnapshot } from './git-pr-checks-parse'

// The poll loop used to hard-code the merge gate's verdict. `gh pr checks --watch` asked a weaker
// question — have the checks finished? — so the watch that replaced it needs its own
// (joshuafolkken/kit#1028). These assertions are about the seam, not about either verdict.
//
// **The default is the load-bearing half.** An omitted `evaluator` must still be the merge gate's,
// because every existing caller omits it and the merge decision is what one of them then makes.

const BRANCH = 'feature-branch'
const NEVER_MERGEABLE = make_pr_snapshot({ merge_state_status: 'BLOCKED' })
const FAILURE_NOTE = 'the custom evaluator refused'

function always(state: 'success' | 'pending' | 'failure'): PrStateEvaluator {
	return { evaluate: () => state, describe: () => FAILURE_NOTE }
}

async function wait_with(input: {
	snapshot: PrStateSnapshot
	evaluator?: PrStateEvaluator
}): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name: BRANCH,
		fetcher: async () => input.snapshot,
		interval_ms: 0,
		max_attempts: 3,
		required_stable_reads: 1,
		...(input.evaluator !== undefined && { evaluator: input.evaluator }),
	})
}

describe('MERGE_GATE_EVALUATOR', () => {
	it('is the merge gate’s own verdict and message', () => {
		expect(MERGE_GATE_EVALUATOR.evaluate).toBe(evaluate_pr_state)
		expect(MERGE_GATE_EVALUATOR.describe).toBe(describe_pr_failure)
	})

	// PR #2698: a label change started a second CI run on the same commit and concurrency cancelled
	// it. GitHub held the pull request `BLOCKED` on that suite, and the gate that read every check green
	// waited on `BLOCKED` as pending for its whole budget (joshuafolkken/kit#2700).
	it('fails at once on a cancelled check in a second suite instead of waiting on BLOCKED', () => {
		const check_runs_json = check_runs_pages([
			{
				id: 1,
				name: 'SonarQube',
				status: 'completed',
				conclusion: 'cancelled',
				check_suite: { id: 100 },
			},
			{
				id: 2,
				name: 'SonarQube',
				status: 'completed',
				conclusion: 'success',
				check_suite: { id: 200 },
			},
		])
		const rollup = to_status_check_rollup({ check_runs_json, status_json: status_pages([]) })
		const snapshot = parse_pr_state_snapshot(
			JSON.stringify({ statusCheckRollup: rollup, mergeStateStatus: 'BLOCKED' }),
		)

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})
})

describe('wait_for_pr_success — the evaluator seam', () => {
	// A pull request the merge gate would never pass, accepted by an evaluator that asks less.
	it('honors a custom evaluator that accepts what the merge gate refuses', async () => {
		await expect(
			wait_with({ snapshot: NEVER_MERGEABLE, evaluator: always('success') }),
		).resolves.toBe(NEVER_MERGEABLE)
	})

	it('throws the custom evaluator’s own message on failure', async () => {
		await expect(
			wait_with({ snapshot: NEVER_MERGEABLE, evaluator: always('failure') }),
		).rejects.toThrow(FAILURE_NOTE)
	})

	it('keeps polling while the custom evaluator answers pending', async () => {
		await expect(
			wait_with({ snapshot: NEVER_MERGEABLE, evaluator: always('pending') }),
		).rejects.toThrow(/Timed out/u)
	})

	// Omitting it must leave every existing caller exactly where it was.
	it('falls back to the merge gate when no evaluator is given', async () => {
		await expect(wait_with({ snapshot: NEVER_MERGEABLE })).rejects.toThrow(/Timed out/u)
	})

	it('still succeeds on a mergeable pull request with no evaluator given', async () => {
		const snapshot = make_pr_snapshot()

		await expect(wait_with({ snapshot })).resolves.toBe(snapshot)
	})
})
