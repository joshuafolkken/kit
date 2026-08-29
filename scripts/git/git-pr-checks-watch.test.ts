import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'
import {
	CHECK_WAIT_INTERVAL_MS,
	compute_max_attempts,
	default_fetch_pr_state,
	DEFAULT_STABLE_READS,
	PR_CHECKS_TIMEOUT_MESSAGE,
	SECONDS_TO_MS,
	wait_for_pr_success,
} from './git-pr-checks'
import { evaluate_pr_state } from './git-pr-checks-eval'
import { make_pr_snapshot, SONAR_QUBE } from './git-pr-checks-fixture'
import type { PrStateSnapshot } from './git-pr-checks-parse'
import {
	CHECKS_FAILED_MESSAGE,
	CHECKS_SETTLED_EVALUATOR,
	describe_checks_failure,
	evaluate_checks_settled,
	fail_when_no_checks,
	git_pr_checks_watch,
	NO_CHECKS_MESSAGE,
	PR_CHECKS_WATCH_TIMEOUT_MS,
} from './git-pr-checks-watch'

// `gh pr checks --watch` streamed, and REST cannot stream (joshuafolkken/kit#1028). What the two
// callers actually read is `timed_out`, so the watch is now the existing poll loop bounded to the
// same two minutes — asking the weaker question `gh` asked, not the merge gate's.

// Only the loop is replaced. `is_pr_checks_timeout` and `compute_max_attempts` stay real, because
// the message the watch reads a timeout by is exactly what a stub would be free to get wrong.
vi.mock('./git-gh-pr-snapshot', () => ({
	git_gh_pr_snapshot: { pr_get_state_snapshot: vi.fn() },
}))

vi.mock('./git-pr-checks', async (import_original) => {
	// Typed as a plain record rather than as the module: naming the module's own type here needs a
	// namespace import, which this project bans.
	const actual = await import_original<Record<string, unknown>>()

	return { ...actual, wait_for_pr_success: vi.fn() }
})

const wait = vi.mocked(wait_for_pr_success)
const fetch_state = vi.mocked(git_gh_pr_snapshot.pr_get_state_snapshot)

const BRANCH = 'feature-branch'
const READ_FAILED = 'gh unavailable'
const NOT_TIMED_OUT = { timed_out: false }
const TIMED_OUT = { timed_out: true }
const TWO_MINUTES_MS = 120_000
const E2E = 'E2E'
const EMPTY_SNAPSHOT = make_pr_snapshot({ rollup: [] })

// Deliberately carrying the states that would make the *merge gate* refuse: the watch must not read
// either of them.
function settled(rollup: ReadonlyArray<{ name: string; status: string }>): PrStateSnapshot {
	return make_pr_snapshot({
		rollup: [...rollup],
		merge_state_status: 'BLOCKED',
		review_decision: 'CHANGES_REQUESTED',
	})
}

const ALL_PASSING = settled([{ name: SONAR_QUBE, status: 'pass' }])
const ONE_PENDING = settled([
	{ name: SONAR_QUBE, status: 'pass' },
	{ name: E2E, status: 'pending' },
])
const ONE_FAILING = settled([
	{ name: SONAR_QUBE, status: 'pass' },
	{ name: E2E, status: 'fail' },
])

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	wait.mockResolvedValue(EMPTY_SNAPSHOT)
})

// **The difference this evaluator exists for.** `evaluate_pr_state` answers `success` only for a
// *mergeable* pull request; `gh pr checks --watch` knew nothing about the merge state or the review
// decision. Handing the watch the merge gate's verdict would have made it unable to succeed at all
// on a repository requiring an approving review, and would have made a standing change request throw
// out of `pnpm josh git`.
describe('evaluate_checks_settled — the weaker question the watch asks', () => {
	it('succeeds once every check has settled', () => {
		expect(evaluate_checks_settled(ALL_PASSING)).toBe('success')
	})

	it('succeeds even where the merge gate would refuse', () => {
		expect(evaluate_pr_state(ALL_PASSING)).toBe('failure')
		expect(evaluate_checks_settled(ALL_PASSING)).toBe('success')
	})

	it('keeps waiting while any check is pending', () => {
		expect(evaluate_checks_settled(ONE_PENDING)).toBe('pending')
	})

	it('fails on a check that failed, as the watch process did', () => {
		expect(evaluate_checks_settled(ONE_FAILING)).toBe('failure')
	})

	// **An empty rollup keeps waiting rather than failing.** `git-pr.ts` starts the watch five seconds
	// after opening the pull request, where GitHub routinely has not attached a check run yet — failing
	// there would make `pnpm josh git` exit red on a healthy run. Whether the branch really has no
	// checks is asked once, after the budget runs out.
	it('keeps waiting on a branch whose checks have not appeared yet', () => {
		expect(evaluate_checks_settled(EMPTY_SNAPSHOT)).toBe('pending')
	})
})

describe('describe_checks_failure', () => {
	// Naming the check is what turns a red watch into something actionable.
	it('names the checks that failed', () => {
		expect(describe_checks_failure(ONE_FAILING)).toBe(`${CHECKS_FAILED_MESSAGE}: ${E2E}`)
	})
})

describe('pr_checks_watch — what it asks the poll loop for', () => {
	// The budget the `execa` timeout carried, kept so the two-stage wait still looks ahead for two
	// minutes before handing over to the full poll.
	it('still bounds the watch at two minutes', () => {
		expect(PR_CHECKS_WATCH_TIMEOUT_MS).toBe(TWO_MINUTES_MS)
	})

	it('polls for exactly that budget, with the settled evaluator', async () => {
		await git_pr_checks_watch.pr_checks_watch(BRANCH)

		expect(wait.mock.calls[0]?.[0]).toMatchObject({
			branch_name: BRANCH,
			fetcher: default_fetch_pr_state,
			interval_ms: CHECK_WAIT_INTERVAL_MS,
			max_attempts: compute_max_attempts(
				PR_CHECKS_WATCH_TIMEOUT_MS / SECONDS_TO_MS,
				CHECK_WAIT_INTERVAL_MS,
			),
			required_stable_reads: DEFAULT_STABLE_READS,
			evaluator: CHECKS_SETTLED_EVALUATOR,
		})
	})

	// No new loop is written here — that is the whole point of the conversion.
	it('reuses the existing poll loop rather than driving gh', async () => {
		await git_pr_checks_watch.pr_checks_watch(BRANCH)

		expect(wait).toHaveBeenCalledTimes(1)
	})
})

describe('pr_checks_watch — the WatchResult contract', () => {
	it('reports the checks settled when the poll succeeds', async () => {
		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).resolves.toStrictEqual(NOT_TIMED_OUT)
	})

	// Running out the budget is the answer `timed_out` carries, exactly as the killed `gh` process
	// was: `git-pr.ts` prints "CI still running" rather than failing the run.
	it('reports a timeout when the poll runs out', async () => {
		wait.mockRejectedValue(new Error(PR_CHECKS_TIMEOUT_MESSAGE))
		fetch_state.mockResolvedValue(JSON.stringify({ statusCheckRollup: [{ name: E2E }] }))

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).resolves.toStrictEqual(TIMED_OUT)
	})

	it('rethrows a failing check rather than calling it a timeout', async () => {
		wait.mockRejectedValue(new Error(`${CHECKS_FAILED_MESSAGE}: ${E2E}`))

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).rejects.toThrow(CHECKS_FAILED_MESSAGE)
	})

	it('rethrows a read that failed', async () => {
		wait.mockRejectedValue(new Error(READ_FAILED))

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).rejects.toThrow(READ_FAILED)
	})
})

// `gh pr checks` exited non-zero for a branch with no checks at all just as it did for a failed one,
// and `git-pr-followup.ts` relies on that to fail rather than spend its whole 32-minute budget on a
// required check that is *missing* rather than pending (joshuafolkken/kit#999). Asking after the
// budget rather than on every poll is what gives a freshly opened pull request its two minutes.
describe('fail_when_no_checks', () => {
	it('throws when the rollup is still empty after the budget', async () => {
		fetch_state.mockResolvedValue(JSON.stringify({ statusCheckRollup: [] }))

		await expect(fail_when_no_checks(BRANCH)).rejects.toThrow(NO_CHECKS_MESSAGE)
	})

	it('says nothing when the branch does have checks', async () => {
		fetch_state.mockResolvedValue(JSON.stringify({ statusCheckRollup: [{ name: E2E }] }))

		await expect(fail_when_no_checks(BRANCH)).resolves.toBeUndefined()
	})

	// The watch reports a timeout only after this read agrees the branch does have checks, so a
	// no-checks branch never comes back as `timed_out`.
	it('turns a timed-out watch on a checkless branch into a failure', async () => {
		wait.mockRejectedValue(new Error(PR_CHECKS_TIMEOUT_MESSAGE))
		fetch_state.mockResolvedValue(JSON.stringify({ statusCheckRollup: [] }))

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).rejects.toThrow(NO_CHECKS_MESSAGE)
	})
})
