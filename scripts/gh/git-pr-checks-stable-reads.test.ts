import { describe, expect, it } from 'vitest'
import {
	wait_for_pr_success,
	WATCH_CONFIRMED_STABLE_READS,
	type PrStateSnapshot,
} from './git-pr-checks'
import {
	make_pr_snapshot,
	make_sequence_fetcher,
	pending_rollup_snapshot,
} from './git-pr-checks-fixture'

// joshuafolkken/kit#2029: once `pr_checks_watch` has confirmed every check finished, the poll that
// follows need only agree once, so `run_checks` lowers the stable-read requirement to
// `WATCH_CONFIRMED_STABLE_READS`. A separate suite from `git-pr-checks.test.ts` because that file was
// already at its length limit, the same split the watch suite made.

const BRANCH_NAME = 'feature/x'
const MAX_ATTEMPTS = 10
const CHANGES_REQUESTED = 'CHANGES_REQUESTED'

async function wait_confirmed(fetcher: () => Promise<PrStateSnapshot>): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name: BRANCH_NAME,
		fetcher,
		interval_ms: 0,
		max_attempts: MAX_ATTEMPTS,
		required_stable_reads: WATCH_CONFIRMED_STABLE_READS,
	})
}

describe('wait_for_pr_success — a confirmed watch needs only one stable read', () => {
	it('returns after a single success read', async () => {
		const sequence = make_sequence_fetcher([make_pr_snapshot()])

		const result = await wait_confirmed(sequence.fetch)

		expect(result.merge_state_status).toBe('CLEAN')
		expect(sequence.count()).toBe(1)
	})

	// The window is shorter, not the gate weaker: a check that turns red after looking pending — a
	// re-run, say — is read as a failure and throws rather than being returned as success.
	it('throws when a check turns red after looking pending', async () => {
		const red = make_pr_snapshot({ review_decision: CHANGES_REQUESTED })
		const sequence = make_sequence_fetcher([pending_rollup_snapshot(), red])

		await expect(wait_confirmed(sequence.fetch)).rejects.toThrow(/review requested changes/u)
	})
})
