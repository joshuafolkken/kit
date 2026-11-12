import { describe, expect, it, vi } from 'vitest'
import { check_runs_pages, status_pages } from './git-gh-pr-fixture'
import { to_status_check_rollup } from './git-gh-pr-rollup'
import {
	DEFAULT_STABLE_READS,
	MAX_CONSECUTIVE_READ_FAILURES,
	MERGE_GATE_EVALUATOR,
	PR_CHECKS_TIMEOUT_MESSAGE,
	wait_for_pr_success,
	WATCH_CONFIRMED_STABLE_READS,
	type PrStateEvaluator,
	type PrStateFetcher,
} from './git-pr-checks'
import { describe_pr_failure, evaluate_pr_state } from './git-pr-checks-eval'
import {
	make_pr_snapshot,
	make_sequence_fetcher,
	pending_rollup_snapshot,
	SONAR_QUBE,
} from './git-pr-checks-fixture'
import { parse_pr_state_snapshot, type PrStateSnapshot } from './git-pr-checks-parse'

// `wait_for_pr_success` driven by an injected fetcher, one describe per aspect of the poll loop. A
// separate suite from `git-pr-checks.test.ts`, which is at its length limit.

const BRANCH = 'feature/poll'
// Enough attempts that nothing below ends on the loop's own budget unless the test is about it.
const MANY_ATTEMPTS = 10
// One attempt per scripted step, so the wait cannot outlive the script.
const EXACT_ATTEMPTS = 3

type WaitOptions = Parameters<typeof wait_for_pr_success>[0]

async function wait_on(
	options: Partial<WaitOptions> & Pick<WaitOptions, 'fetcher'>,
): Promise<PrStateSnapshot> {
	return await wait_for_pr_success({
		branch_name: BRANCH,
		interval_ms: 0,
		max_attempts: MANY_ATTEMPTS,
		required_stable_reads: 1,
		...options,
	})
}

// joshuafolkken/kit#3773: `josh followup` asks before every CI poll whether a person updated the
// run's issue, and a throw there ends the wait unmerged.
describe('wait_for_pr_success — the check before every poll', () => {
	const unread_update = 'A person updated issue #3773'

	it('asks before every poll', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const before_poll = vi.fn(async () => undefined)
		const sequence = make_sequence_fetcher([pending_rollup_snapshot()])

		await expect(
			wait_on({ fetcher: sequence.fetch, max_attempts: EXACT_ATTEMPTS, before_poll }),
		).rejects.toThrow()
		expect(before_poll).toHaveBeenCalledTimes(EXACT_ATTEMPTS)
	})

	it('ends the wait with the refusal, before reading the checks', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const sequence = make_sequence_fetcher([pending_rollup_snapshot()])

		await expect(
			wait_on({
				fetcher: sequence.fetch,
				before_poll: async () => {
					throw new Error(unread_update)
				},
			}),
		).rejects.toThrow(unread_update)
		expect(sequence.count()).toBe(0)
	})
})

// joshuafolkken/kit#2029: once `pr_checks_watch` has confirmed every check finished, the poll that
// follows need only agree once, so `run_checks` lowers the stable-read requirement to
// `WATCH_CONFIRMED_STABLE_READS`.
async function wait_confirmed(fetcher: PrStateFetcher): Promise<PrStateSnapshot> {
	return await wait_on({ fetcher, required_stable_reads: WATCH_CONFIRMED_STABLE_READS })
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
		const red = make_pr_snapshot({ review_decision: 'CHANGES_REQUESTED' })
		const sequence = make_sequence_fetcher([pending_rollup_snapshot(), red])

		await expect(wait_confirmed(sequence.fetch)).rejects.toThrow(/review requested changes/u)
	})
})

// joshuafolkken/kit#1077. `attempt_pr_success_poll` called the fetcher with no `catch`, so one failed
// read during a merge-gate wait rejected out of the loop and ended `followup` — and the
// whole run then had to be paid for again. The decision recorded on the issue was to re-read on the
// next poll, with two properties held: a read that failed is never treated as an answer, and
// consecutive failures are capped.
//
// **Every assertion here is about which of the two a poll came back with.** A failed *read* is
// retried; a `failure` *verdict* is the checks being red, and retrying that would undo the fast fail
// joshuafolkken/kit#990 added.
const READ_FAILURE = 'gh api could not be reached'

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

async function wait_scripted(
	steps: ReadonlyArray<PollStep>,
	max_attempts: number = MANY_ATTEMPTS,
): Promise<PrStateSnapshot> {
	return await wait_on({
		fetcher: make_scripted_fetcher(steps),
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
		const result = await wait_scripted([read_failure(), make_pr_snapshot()])

		expect(result).toStrictEqual(make_pr_snapshot())
	})

	it('gives up at the consecutive-failure cap, carrying the failure that caused it', async () => {
		const steps = Array.from({ length: MAX_CONSECUTIVE_READ_FAILURES }, read_failure)

		await expect(wait_scripted(steps)).rejects.toThrow(READ_FAILURE)
	})

	it('puts the failure counter back to zero after a read that succeeded', async () => {
		const result = await wait_scripted([
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

		await expect(wait_scripted(steps, EXACT_ATTEMPTS)).rejects.toThrow(PR_CHECKS_TIMEOUT_MESSAGE)
	})

	// Running out of attempts on a poll nobody could read is not "the checks are still running".
	// `is_pr_checks_timeout` matches on that prose, so a timeout here would let the bounded watch in
	// `git-pr-checks-watch.ts` answer `timed_out` for expired auth or a rate limit.
	it('ends on the read failure rather than the timeout when the last poll went unread', async () => {
		const steps = [make_pr_snapshot(), read_failure()]

		await expect(wait_scripted(steps, EXACT_ATTEMPTS)).rejects.toThrow(READ_FAILURE)
	})

	// The tolerance is for reads, not for verdicts: these snapshots would resolve if the failing one
	// were retried away.
	it('does not retry a failing check verdict', async () => {
		const steps = [failing_snapshot(), make_pr_snapshot(), make_pr_snapshot()]

		await expect(wait_scripted(steps)).rejects.toThrow(SONAR_QUBE)
	})
})

// joshuafolkken/kit#5780: the timeout carried nothing of the last read, so a park on it named no cause.
describe('wait_for_pr_success running out of budget on a blocked pull request', () => {
	it('keeps the timeout message and names the missing required context in its cause', async () => {
		const blocked = make_pr_snapshot({
			merge_state_status: 'BLOCKED',
			required_contexts: ['Checks', SONAR_QUBE],
		})

		await expect(wait_scripted([blocked], EXACT_ATTEMPTS)).rejects.toStrictEqual(
			new Error(PR_CHECKS_TIMEOUT_MESSAGE, { cause: 'BLOCKED: Checks missing' }),
		)
	})
})

// The merge gate and `gh pr checks --watch` ask different questions: merge readiness and check
// completion. The watch therefore needs its own evaluator (joshuafolkken/kit#1028).
//
// **The default is the load-bearing half.** An omitted `evaluator` must still be the merge gate's,
// because every existing caller omits it and the merge decision is what one of them then makes.
const NEVER_MERGEABLE = make_pr_snapshot({ merge_state_status: 'BLOCKED' })
const FAILURE_NOTE = 'the custom evaluator refused'

function always(state: 'success' | 'pending' | 'failure'): PrStateEvaluator {
	return { evaluate: () => state, describe: () => FAILURE_NOTE }
}

function rollup_snapshot(
	runs: ReadonlyArray<Record<string, unknown>>,
	merge_state_status: string,
): PrStateSnapshot {
	const check_runs_json = check_runs_pages(runs)
	const rollup = to_status_check_rollup({ check_runs_json, status_json: status_pages([]) })

	return parse_pr_state_snapshot(
		JSON.stringify({ statusCheckRollup: rollup, mergeStateStatus: merge_state_status }),
	)
}

describe('MERGE_GATE_EVALUATOR', () => {
	it('is the merge gate’s own verdict and message', () => {
		expect(MERGE_GATE_EVALUATOR.evaluate).toBe(evaluate_pr_state)
		expect(MERGE_GATE_EVALUATOR.describe).toBe(describe_pr_failure)
	})

	it.each([
		['completed', 'success', 'success'],
		['completed', 'failure', 'failure'],
	] as const)(
		'uses the latest classification rerun when it is %s and %s',
		(status, conclusion, expected) => {
			const snapshot = rollup_snapshot(
				[
					{ id: 1, name: 'Checks', status: 'completed', conclusion: 'failure' },
					{ id: 2, name: 'Checks', status, conclusion },
					{ id: 3, name: 'SonarQube', status: 'completed', conclusion: 'success' },
				],
				'CLEAN',
			)

			expect(evaluate_pr_state(snapshot)).toBe(expected)
		},
	)

	it('waits while the latest required check rerun is in progress', () => {
		const snapshot = rollup_snapshot(
			[
				{ id: 1, name: 'SonarQube', status: 'completed', conclusion: 'failure' },
				{ id: 2, name: 'SonarQube', status: 'in_progress' },
			],
			'CLEAN',
		)

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})
})

describe('MERGE_GATE_EVALUATOR — check suites', () => {
	// PR #2698: a label change started a second CI run on the same commit and concurrency cancelled
	// it. That newer suite held the pull request `BLOCKED`, and the gate that read the older suite's
	// later-created success waited on `BLOCKED` as pending for its whole budget (joshuafolkken/kit#2700).
	it('fails at once on a cancelled check in the newer suite instead of waiting on BLOCKED', () => {
		const snapshot = rollup_snapshot(
			[
				{
					id: 1,
					name: 'SonarQube',
					status: 'completed',
					conclusion: 'cancelled',
					check_suite: { id: 200 },
				},
				{
					id: 2,
					name: 'SonarQube',
					status: 'completed',
					conclusion: 'success',
					check_suite: { id: 100 },
				},
			],
			'BLOCKED',
		)

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})
})

async function wait_constant(
	snapshot: PrStateSnapshot,
	evaluator?: PrStateEvaluator,
): Promise<PrStateSnapshot> {
	return await wait_on({
		fetcher: async () => snapshot,
		max_attempts: EXACT_ATTEMPTS,
		...(evaluator !== undefined && { evaluator }),
	})
}

describe('wait_for_pr_success — the evaluator seam', () => {
	// A pull request the merge gate would never pass, accepted by an evaluator that asks less.
	it('honors a custom evaluator that accepts what the merge gate refuses', async () => {
		await expect(wait_constant(NEVER_MERGEABLE, always('success'))).resolves.toBe(NEVER_MERGEABLE)
	})

	it('throws the custom evaluator’s own message on failure', async () => {
		await expect(wait_constant(NEVER_MERGEABLE, always('failure'))).rejects.toThrow(FAILURE_NOTE)
	})

	it('keeps polling while the custom evaluator answers pending', async () => {
		await expect(wait_constant(NEVER_MERGEABLE, always('pending'))).rejects.toThrow(/Timed out/u)
	})

	// Omitting it must leave every existing caller exactly where it was.
	it('falls back to the merge gate when no evaluator is given', async () => {
		await expect(wait_constant(NEVER_MERGEABLE)).rejects.toThrow(/Timed out/u)
	})

	it('still succeeds on a mergeable pull request with no evaluator given', async () => {
		const snapshot = make_pr_snapshot()

		await expect(wait_constant(snapshot)).resolves.toBe(snapshot)
	})
})
