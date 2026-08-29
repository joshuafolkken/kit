import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	gh_api_routes,
	PR_BRANCH,
	pr_lookup_path,
	pr_reviews_path,
	pr_routes,
	status_pages,
} from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'
import {
	NO_HEAD_SHA_MESSAGE,
	NO_PULL_REQUEST_MESSAGE,
	pr_get_state_snapshot,
} from './git-gh-pr-snapshot'
import { evaluate_pr_state } from './git-pr-checks-eval'
import { parse_pr_state_snapshot } from './git-pr-checks-parse'

// The merge gate's snapshot, assembled from four REST reads. `pnpm josh followup --merge` decides a
// pull request is green from this value, so the assertions here are about the whole round trip: what
// the reads ask for, and what `evaluate_pr_state` then makes of the answer (joshuafolkken/kit#1028).

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const SONAR_QUBE = 'SonarQube'
const CODE_RABBIT = 'CodeRabbit'
const PASSING_RUN = { name: SONAR_QUBE, status: 'completed', conclusion: 'success' }
const APPROVED_REVIEW = { state: 'APPROVED', user: { login: 'alice' } }
const NO_REVIEWS = '[]'
const RATE_LIMITED = '{"message":"rate limited"}'

function routes(input: {
	pull?: Record<string, unknown>
	check_runs?: string
	statuses?: string
	reviews?: string
}): Record<string, string> {
	return pr_routes(input.pull ?? {}, {
		[commit_check_runs_path()]: input.check_runs ?? check_runs_pages([PASSING_RUN]),
		[commit_status_path()]: input.statuses ?? status_pages([]),
		[pr_reviews_path()]: input.reviews ?? NO_REVIEWS,
	})
}

async function read_snapshot(
	input: Parameters<typeof routes>[0] = {},
): Promise<ReturnType<typeof parse_pr_state_snapshot>> {
	mocked_api.mockImplementation(gh_api_routes(routes(input)))

	return parse_pr_state_snapshot(await pr_get_state_snapshot(PR_BRANCH))
}

beforeEach(() => {
	vi.clearAllMocks()
	forget_pr_numbers()
})

describe('pr_get_state_snapshot — the three fields', () => {
	it('carries the rollup the two commit endpoints reported', async () => {
		const snapshot = await read_snapshot({
			statuses: status_pages([{ context: CODE_RABBIT, state: 'success' }]),
		})

		expect(snapshot.rollup).toStrictEqual([
			{ name: SONAR_QUBE, status: 'pass' },
			{ name: CODE_RABBIT, status: 'pass' },
		])
	})

	it('folds the review history into a review decision', async () => {
		const snapshot = await read_snapshot({ reviews: JSON.stringify([APPROVED_REVIEW]) })

		expect(snapshot.review_decision).toBe('APPROVED')
	})

	// `gh` answered the empty string, which `read_string` folds to `undefined` — the same answer the
	// GraphQL field gave on a pull request nobody had reviewed.
	it('leaves the review decision unset when nobody has reviewed', async () => {
		const snapshot = await read_snapshot()

		expect(snapshot.review_decision).toBeUndefined()
	})
})

// **REST is lower case and `gh` was upper case.** `git-pr-checks-eval.ts` compares strictly, so
// failing to upper-case would make CLEAN never match — which also takes every pull request out of
// the kit#753 escape hatch keyed on UNSTABLE.
describe('pr_get_state_snapshot — mergeable_state is upper-cased', () => {
	it.each([
		['clean', 'CLEAN'],
		['unstable', 'UNSTABLE'],
		['blocked', 'BLOCKED'],
		['unknown', 'UNKNOWN'],
	])('reads %s as %s', async (rest_state, gh_state) => {
		const snapshot = await read_snapshot({ pull: { mergeable_state: rest_state } })

		expect(snapshot.merge_state_status).toBe(gh_state)
	})

	// The end the casing exists for: a clean pull request whose required checks pass is green.
	it('lets a clean pull request reach success', async () => {
		const snapshot = await read_snapshot({ pull: { mergeable_state: 'clean' } })

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	// And an unstable one whose only non-passing check is CodeRabbit's still reaches it, which is the
	// kit#753 escape hatch the casing would otherwise have disabled.
	it('keeps the CodeRabbit escape hatch reachable on UNSTABLE', async () => {
		const snapshot = await read_snapshot({
			pull: { mergeable_state: 'unstable' },
			statuses: status_pages([{ context: CODE_RABBIT, state: 'pending' }]),
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('pr_get_state_snapshot — which endpoints it reads', () => {
	it('pages every listing a full page at a time', async () => {
		await read_snapshot()

		const paged = mocked_api.mock.calls
			.map(([request]) => request)
			.filter((request) => request.should_paginate === true)

		expect(paged).toHaveLength(3)
	})

	// The two commit endpoints answer an object wrapping the listing, so `--paginate` alone would emit
	// one document per page and `JSON.parse` would reject the pair. The reviews endpoint answers a
	// bare array, whose pages `gh` merges on its own — slurping it would wrap them again.
	it('slurps the two commit endpoints and not the review listing', async () => {
		await read_snapshot()

		const slurped = mocked_api.mock.calls
			.map(([request]) => request.path)
			.filter((_path, index) => mocked_api.mock.calls[index]?.[0].should_slurp === true)

		expect(slurped).toStrictEqual([commit_check_runs_path(), commit_status_path()])
	})

	// The rollup hangs off the head commit, not off the pull request number.
	it('keys the rollup on the head commit', async () => {
		await read_snapshot()

		const paths = mocked_api.mock.calls.map(([request]) => request.path)

		expect(paths).toContain(commit_check_runs_path())
	})
})

// Folding a failure into an empty snapshot would read as "no checks, nothing requested" — green.
describe('pr_get_state_snapshot — failures throw rather than answering green', () => {
	it('throws when the branch has no pull request', async () => {
		mocked_api.mockImplementation(gh_api_routes({ [pr_lookup_path()]: '[]' }))

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(NO_PULL_REQUEST_MESSAGE)
	})

	it('throws when the pull request carries no head commit', async () => {
		mocked_api.mockImplementation(gh_api_routes(routes({ pull: { head: { ref: PR_BRANCH } } })))

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(NO_HEAD_SHA_MESSAGE)
	})

	it('throws when a rollup listing could not be read', async () => {
		mocked_api.mockImplementation(gh_api_routes(routes({ check_runs: RATE_LIMITED })))

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(/check run listing/u)
	})

	it('throws when the review listing could not be read', async () => {
		mocked_api.mockImplementation(gh_api_routes(routes({ reviews: RATE_LIMITED })))

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(/review listing/u)
	})
})
