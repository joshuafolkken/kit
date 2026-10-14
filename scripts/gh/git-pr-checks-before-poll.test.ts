import { describe, expect, it, vi } from 'vitest'
import { wait_for_pr_success, type PrStateSnapshot } from './git-pr-checks'
import { make_sequence_fetcher, pending_rollup_snapshot } from './git-pr-checks-fixture'

// joshuafolkken/kit#3773: `josh followup` asks before every CI poll whether a person updated the
// run's issue, and a throw there ends the wait unmerged. A separate suite from
// `git-pr-checks.test.ts`, which is at its length limit.

const BRANCH_NAME = 'feature/x'
const MAX_ATTEMPTS = 3
const UNREAD_UPDATE = 'A person updated issue #3773'

async function wait_with(
	fetcher: () => Promise<PrStateSnapshot>,
	before_poll: () => Promise<void>,
): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name: BRANCH_NAME,
		fetcher,
		interval_ms: 0,
		max_attempts: MAX_ATTEMPTS,
		required_stable_reads: 1,
		before_poll,
	})
}

describe('wait_for_pr_success — the check before every poll', () => {
	it('asks before every poll', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const before_poll = vi.fn(async () => undefined)
		const sequence = make_sequence_fetcher([pending_rollup_snapshot()])

		await expect(wait_with(sequence.fetch, before_poll)).rejects.toThrow()
		expect(before_poll).toHaveBeenCalledTimes(MAX_ATTEMPTS)
	})

	it('ends the wait with the refusal, before reading the checks', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const sequence = make_sequence_fetcher([pending_rollup_snapshot()])

		await expect(
			wait_with(sequence.fetch, async () => {
				throw new Error(UNREAD_UPDATE)
			}),
		).rejects.toThrow(UNREAD_UPDATE)
		expect(sequence.count()).toBe(0)
	})
})
