import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	gh_api_routes,
	PR_BRANCH,
	pr_reviews_path,
	pr_routes,
	status_pages,
} from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'
import {
	default_fetch_pr_state,
	MERGE_GATE_EVALUATOR,
	SHOULD_ALWAYS_READ_REVIEW_DECISION,
} from './git-pr-checks'
import { evaluate_pr_state, is_review_decision_decisive } from './git-pr-checks-eval'
import { SHOULD_NEVER_READ_REVIEW_DECISION } from './git-pr-checks-watch'

// **How many REST requests one poll of the merge gate costs, measured rather than reasoned about.**
//
// joshuafolkken/kit#1028 replaced one GraphQL call with four REST reads, and `wait_for_pr_success`
// repeats them every ten seconds for up to 32 minutes — about 800 requests for one `followup`, which
// a `queue` or an `epicrun` runs back to back. The counts below are the whole point of
// joshuafolkken/kit#1043, so they are asserted as numbers: a fifth read added anywhere fails here
// rather than showing up as a rate limit weeks later.
//
// **The direction that must never move is the other one.** The review listing is skipped only where
// the snapshot without it is not already green, because `review_decision` can do exactly one thing —
// turn `success` into `failure`. The poll that concludes a merge therefore always carries a review
// decision read in that same poll, and nothing is remembered between polls.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const SONAR_QUBE = 'SonarQube'
const PASSING_RUN = { name: SONAR_QUBE, status: 'completed', conclusion: 'success' }
const PENDING_RUN = { name: SONAR_QUBE, status: 'queued' }
const FAILING_RUN = { name: SONAR_QUBE, status: 'completed', conclusion: 'failure' }
const CHANGES_REQUESTED_REVIEW = { state: 'CHANGES_REQUESTED', user: { login: 'alice' } }
const NO_REVIEWS = '[]'

// The steady-state cost of one poll, and the cost of the poll that can conclude a merge.
const CHECKS_ONLY_REQUESTS = 3
const WITH_REVIEW_REQUESTS = 4
// The branch → number lookup, which the memo in `git-gh-pr-read.ts` pays for only once per process.
const FIRST_POLL_LOOKUP = 1

function pick_run(input: { is_green: boolean; failing_check?: boolean }): Record<string, unknown> {
	if (input.failing_check === true) return FAILING_RUN

	return input.is_green ? PASSING_RUN : PENDING_RUN
}

function arrange(input: { is_green: boolean; reviews?: string; failing_check?: boolean }): void {
	const check_runs = check_runs_pages([pick_run(input)])
	const statuses = status_pages([])
	const pull = { mergeable_state: input.is_green ? 'clean' : 'unknown' }
	const listings = {
		[commit_check_runs_path()]: check_runs,
		[commit_status_path()]: statuses,
		[pr_reviews_path()]: input.reviews ?? NO_REVIEWS,
	}

	mocked_api.mockImplementation(gh_api_routes(pr_routes(pull, listings)))
}

function review_reads(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === pr_reviews_path()).length
}

// The predicate the poll loop hands the fetcher, taken off the evaluator rather than restated — the
// fallback is the loop's own default, so the test cannot pass against a predicate nobody wired up.
const MERGE_GATE_PREDICATE =
	MERGE_GATE_EVALUATOR.should_read_review_decision ?? SHOULD_ALWAYS_READ_REVIEW_DECISION

beforeEach(() => {
	vi.clearAllMocks()
	forget_pr_numbers()
})

describe('is_review_decision_decisive — when the review listing can change the verdict', () => {
	it('is decisive on a snapshot that is otherwise green', () => {
		const snapshot = {
			rollup: [{ name: SONAR_QUBE, status: 'pass' }],
			merge_state_status: 'CLEAN',
			review_decision: undefined,
		}

		expect(evaluate_pr_state(snapshot)).toBe('success')
		expect(is_review_decision_decisive(snapshot)).toBe(true)
	})

	// A pending snapshot stays non-merging with or without a change request, so the read buys nothing.
	it('is not decisive while a required check is still pending', () => {
		expect(
			is_review_decision_decisive({
				rollup: [{ name: SONAR_QUBE, status: 'pending' }],
				merge_state_status: 'CLEAN',
				review_decision: undefined,
			}),
		).toBe(false)
	})

	// A failed check ends the wait, and `describe_pr_failure` names the reasons: dropping "review
	// requested changes" from that message would lose half the diagnosis, so the read still happens.
	it('is decisive once a check has failed, so the message can name both reasons', () => {
		expect(
			is_review_decision_decisive({
				rollup: [{ name: SONAR_QUBE, status: 'fail' }],
				merge_state_status: 'CLEAN',
				review_decision: undefined,
			}),
		).toBe(true)
	})
})

describe('default_fetch_pr_state — requests per poll', () => {
	it('costs three requests while the checks are still running', async () => {
		arrange({ is_green: false })

		await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)
		mocked_api.mockClear()
		await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(mocked_api).toHaveBeenCalledTimes(CHECKS_ONLY_REQUESTS)
		expect(review_reads()).toBe(0)
	})

	// The branch lookup is the one extra request of the first poll; the memo absorbs it after that.
	it('adds only the branch lookup on the first poll', async () => {
		arrange({ is_green: false })

		await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(mocked_api).toHaveBeenCalledTimes(CHECKS_ONLY_REQUESTS + FIRST_POLL_LOOKUP)
	})

	it('costs the fourth request on the poll that could conclude a merge', async () => {
		arrange({ is_green: true })

		await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)
		mocked_api.mockClear()
		await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(mocked_api).toHaveBeenCalledTimes(WITH_REVIEW_REQUESTS)
		expect(review_reads()).toBe(1)
	})

	// The watch's verdict never reads `review_decision`, so it never pays for the listing at all.
	it('never reads the review listing for the watch', async () => {
		arrange({ is_green: true })

		await default_fetch_pr_state(PR_BRANCH, SHOULD_NEVER_READ_REVIEW_DECISION)
		mocked_api.mockClear()
		await default_fetch_pr_state(PR_BRANCH, SHOULD_NEVER_READ_REVIEW_DECISION)

		expect(mocked_api).toHaveBeenCalledTimes(CHECKS_ONLY_REQUESTS)
		expect(review_reads()).toBe(0)
	})
})

// Omitting the predicate is the conservative answer: every poll reads the listing, as it did before
// the predicate existed, so a new evaluator is never silently cheaper than it is correct.
describe('default_fetch_pr_state — the default when no predicate is given', () => {
	it('reads the listing on every poll', async () => {
		arrange({ is_green: false })

		await default_fetch_pr_state(PR_BRANCH)

		expect(review_reads()).toBe(1)
	})
})

// The poll that ends the wait red pays the fourth request too, so `describe_pr_failure` can name
// both reasons rather than only the failed checks.
describe('default_fetch_pr_state — the poll that fails the pull request', () => {
	it('still costs the fourth request', async () => {
		arrange({ is_green: false, failing_check: true })

		await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)
		mocked_api.mockClear()
		const snapshot = await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(mocked_api).toHaveBeenCalledTimes(WITH_REVIEW_REQUESTS)
		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})
})

// The half that must not move: skipping the read cannot let a change request through.
describe('default_fetch_pr_state — a standing change request still stops a green pull request', () => {
	it('demotes an otherwise-green snapshot to failure', async () => {
		arrange({ is_green: true, reviews: JSON.stringify([CHANGES_REQUESTED_REVIEW]) })

		const snapshot = await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(snapshot.review_decision).toBe('CHANGES_REQUESTED')
		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})

	// `gh` answered the empty string for "no decision", which `read_string` folds to `undefined` —
	// the value `is_review_blocked` is written against.
	it('leaves the decision unset when nobody has reviewed', async () => {
		arrange({ is_green: true })

		const snapshot = await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(snapshot.review_decision).toBeUndefined()
		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	// The skipped read leaves the field unset rather than guessing at it, which is the same value a
	// pull request nobody has reviewed carries.
	it('leaves the decision unset on a poll that skipped the read', async () => {
		arrange({ is_green: false })

		const snapshot = await default_fetch_pr_state(PR_BRANCH, MERGE_GATE_PREDICATE)

		expect(snapshot.review_decision).toBeUndefined()
		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})
})
