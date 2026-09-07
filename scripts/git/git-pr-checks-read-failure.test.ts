import { describe, expect, it } from 'vitest'
import {
	DEFAULT_STABLE_READS,
	MAX_CONSECUTIVE_READ_FAILURES,
	PR_CHECKS_TIMEOUT_MESSAGE,
	wait_for_pr_success,
	type PrStateFetcher,
} from './git-pr-checks'
import { make_pr_snapshot, SONAR_QUBE } from './git-pr-checks-fixture'
import type { PrStateSnapshot } from './git-pr-checks-parse'

// joshuafolkken/kit#1077. `attempt_pr_success_poll` called the fetcher with no `catch`, so one failed
// read during a 32-minute merge-gate wait rejected out of the loop and ended `followup` — and the
// whole run then had to be paid for again. The decision recorded on the issue was to re-read on the
// next poll, with two properties held: a read that failed is never treated as an answer, and
// consecutive failures are capped.
//
// **Every assertion here is about which of the two a poll came back with.** A failed *read* is
// retried; a `failure` *verdict* is the checks being red, and retrying that would undo the fast fail
// joshuafolkken/kit#990 added.
const BRANCH = 'feature/read-failure'
const READ_FAILURE = 'gh api could not be reached'
// Enough attempts that nothing below ends on the loop's own budget unless the test is about it.
const MANY_ATTEMPTS = 10
// One attempt per scripted step, so the wait cannot outlive the script.
const EXACT_ATTEMPTS = 3

type PollStep = PrStateSnapshot | Error

function read_failure(): Error {
	return new Error(READ_FAILURE)
}

// A fetcher driven by a script of outcomes: a snapshot is answered, an `Error` is thrown. The last
// step repeats, so `[failure, snapshot]` means "fails once, then answers from then on".
function make_scripted_fetcher(steps: ReadonlyArray<PollStep>): PrStateFetcher {
	let index = 0

	async function fetch(): Promise<PrStateSnapshot> {
		const step = steps[index] ?? steps.at(-1)

		index += 1

		if (step === undefined) throw new Error('the fetcher was scripted with no steps')
		if (step instanceof Error) throw step

		return step
	}

	return fetch
}

async function wait_with(
	steps: ReadonlyArray<PollStep>,
	max_attempts: number = MANY_ATTEMPTS,
): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name: BRANCH,
		fetcher: make_scripted_fetcher(steps),
		interval_ms: 0,
		max_attempts,
		required_stable_reads: DEFAULT_STABLE_READS,
	})
}

// A pull request GitHub reports as failed: `evaluate_pr_state` answers `failure`, which the loop
// turns into an immediate throw rather than another poll.
function failing_snapshot(): PrStateSnapshot {
	return make_pr_snapshot({ rollup: [{ name: SONAR_QUBE, status: 'fail' }] })
}

describe('wait_for_pr_success with an unreadable poll', () => {
	it('asks again on the next poll instead of ending the wait', async () => {
		const result = await wait_with([read_failure(), make_pr_snapshot()])

		expect(result).toStrictEqual(make_pr_snapshot())
	})

	it('gives up at the consecutive-failure cap, carrying the failure that caused it', async () => {
		const steps = Array.from({ length: MAX_CONSECUTIVE_READ_FAILURES }, read_failure)

		await expect(wait_with(steps)).rejects.toThrow(READ_FAILURE)
	})

	it('puts the failure counter back to zero after a read that succeeded', async () => {
		const result = await wait_with([
			read_failure(),
			read_failure(),
			make_pr_snapshot(),
			read_failure(),
			read_failure(),
			make_pr_snapshot(),
			make_pr_snapshot(),
		])

		expect(result).toStrictEqual(make_pr_snapshot())
	})

	// The stable-read window exists so that one green poll does not merge a pull request whose checks
	// are still settling. A read nobody got must not fill a slot in it — counted as a passing poll, the
	// three steps below would answer `success` on the last one.
	it('resets the stable-read window rather than counting an unread poll as passing', async () => {
		const steps = [make_pr_snapshot(), read_failure(), make_pr_snapshot()]

		await expect(wait_with(steps, EXACT_ATTEMPTS)).rejects.toThrow(PR_CHECKS_TIMEOUT_MESSAGE)
	})

	// Running out of attempts on a poll nobody could read is not "the checks are still running".
	// `is_pr_checks_timeout` matches on that prose, so a timeout here would let the bounded watch in
	// `git-pr-checks-watch.ts` answer `timed_out` for expired auth or a rate limit.
	it('ends on the read failure rather than the timeout when the last poll went unread', async () => {
		const steps = [make_pr_snapshot(), read_failure()]

		await expect(wait_with(steps, EXACT_ATTEMPTS)).rejects.toThrow(READ_FAILURE)
	})

	// The tolerance is for reads, not for verdicts: these snapshots would resolve if the failing one
	// were retried away.
	it('does not retry a failing check verdict', async () => {
		const steps = [failing_snapshot(), make_pr_snapshot(), make_pr_snapshot()]

		await expect(wait_with(steps)).rejects.toThrow(SONAR_QUBE)
	})
})
