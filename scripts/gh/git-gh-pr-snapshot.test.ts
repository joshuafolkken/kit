import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { forget_branch_rules } from './git-gh-branch-rules'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_poll_read } from './git-gh-poll-read'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	conditional_read_over,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	PR_HEAD_SHA,
	pr_lookup_path,
	pr_reviews_path,
	pr_routes,
	status_pages,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import {
	forget_pr_numbers,
	NO_PULL_REQUEST_MESSAGE,
	UNREADABLE_PULL_REQUEST_MESSAGE,
} from './git-gh-pr-read'
import {
	NO_HEAD_SHA_MESSAGE,
	pr_get_checks_snapshot,
	pr_get_review_decision,
	pr_get_state_snapshot,
} from './git-gh-pr-snapshot'
import { evaluate_pr_state } from './git-pr-checks-eval'
import { parse_pr_state_snapshot } from './git-pr-checks-parse'

// The merge gate's snapshot, assembled from four REST reads. `pnpm josh followup` decides a
// pull request is green from this value, so the assertions here are about the whole round trip: what
// the reads ask for, and what `evaluate_pr_state` then makes of the answer (joshuafolkken/kit#1028).

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

vi.mock('./git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// The per-poll reads, answered by the same router (joshuafolkken/kit#4550).
vi.mocked(git_gh_conditional.read_conditional).mockImplementation(conditional_read_over(mocked_api))

const SONAR_QUBE = 'SonarQube'
const CODE_RABBIT = 'CodeRabbit'
const PASSING_RUN = { name: SONAR_QUBE, status: 'completed', conclusion: 'success' }
const APPROVED_REVIEW = { state: 'APPROVED', user: { login: 'alice' } }
const NO_REVIEWS = '[]'
const RATE_LIMITED = '{"message":"rate limited"}'
const LONGER_THAN_A_PAGE = 101

function routes(input: {
	pull?: Record<string, unknown>
	check_runs?: string
	statuses?: string
	reviews?: string
}): Record<string, GhApiAnswer> {
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
	forget_branch_rules()
	git_gh_poll_read.forget_poll_reads()
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

// joshuafolkken/kit#4351 end to end: the required CI has passed and default-setup CodeQL is still
// running — `conclusion: null`, GitHub's `unstable` — and the snapshot reaches the merge.
describe('pr_get_state_snapshot — an optional check still running', () => {
	it('reaches success once the base branch rules are read', async () => {
		const rules_path = `${git_gh_api_path.branch_rules_api_path('main')}${FULL_PAGE_QUERY}`
		const rule = {
			type: 'required_status_checks',
			parameters: { required_status_checks: [{ context: SONAR_QUBE }] },
		}
		const passing = JSON.stringify(PASSING_RUN)
		const running = '{"name":"CodeQL","status":"in_progress","conclusion":null}'
		const check_runs = `[{"check_runs":[${passing},${running}]}]`
		const pull = { mergeable_state: 'unstable', base: { ref: 'main' } }
		const answers = { ...routes({ pull, check_runs }), [rules_path]: JSON.stringify([rule]) }

		mocked_api.mockImplementation(gh_api_routes(answers))

		const snapshot = parse_pr_state_snapshot(await pr_get_state_snapshot(PR_BRANCH))

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('pr_get_state_snapshot — which endpoints it reads', () => {
	it('asks every listing a full page at a time', async () => {
		await read_snapshot()

		const listings = mocked_api.mock.calls
			.map(([request]) => request.path)
			.filter((path) => path.endsWith(FULL_PAGE_QUERY))

		expect(listings).toStrictEqual([
			commit_check_runs_path(),
			commit_status_path(),
			pr_reviews_path(),
		])
	})

	// The two commit endpoints answer an object wrapping the listing, so `--paginate` alone would emit
	// one document per page and `JSON.parse` would reject the pair. The reviews endpoint answers a
	// bare array, whose pages `gh` merges on its own — slurping it would wrap them again.
	it('slurps the two commit endpoints and not the review listing', async () => {
		await read_snapshot({
			check_runs: JSON.stringify([{ total_count: LONGER_THAN_A_PAGE, check_runs: [PASSING_RUN] }]),
			statuses: JSON.stringify([{ total_count: LONGER_THAN_A_PAGE, statuses: [] }]),
		})

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

// The two halves the merge gate reads separately: the checks portion every poll, the review decision
// only where it can change the verdict (joshuafolkken/kit#1043).
describe('the snapshot split into its checks half and its review half', () => {
	it('reads no review listing for the checks half', async () => {
		mocked_api.mockImplementation(gh_api_routes(routes({ pull: { mergeable_state: 'clean' } })))
		const checks = await pr_get_checks_snapshot(PR_BRANCH)

		expect(mocked_api.mock.calls.map(([request]) => request.path)).not.toContain(pr_reviews_path())
		expect(parse_pr_state_snapshot(checks.snapshot_json).merge_state_status).toBe('CLEAN')
	})

	// The number travels with it so the review read that may follow needs no second resolution.
	it('hands back the number the review read is keyed by', async () => {
		mocked_api.mockImplementation(gh_api_routes(routes({})))
		const checks = await pr_get_checks_snapshot(PR_BRANCH)

		await expect(pr_get_review_decision(checks.pr_number)).resolves.toBe('')
	})

	// #4036: the merge names this head, so a checks half without it leaves no commit to bind to.
	it('carries the head commit the rollup was read from', async () => {
		mocked_api.mockImplementation(gh_api_routes(routes({})))
		const checks = await pr_get_checks_snapshot(PR_BRANCH)

		expect(parse_pr_state_snapshot(checks.snapshot_json).head_sha).toBe(PR_HEAD_SHA)
	})

	it('folds the review history when the review half is read', async () => {
		const approved = routes({ reviews: JSON.stringify([APPROVED_REVIEW]) })

		mocked_api.mockImplementation(gh_api_routes(approved))
		const checks = await pr_get_checks_snapshot(PR_BRANCH)

		await expect(pr_get_review_decision(checks.pr_number)).resolves.toBe('APPROVED')
	})
})

// Folding a failure into an empty snapshot would read as "no checks, nothing requested" — green.
describe('pr_get_state_snapshot — failures throw rather than answering green', () => {
	it('throws when the branch has no pull request', async () => {
		mocked_api.mockImplementation(gh_api_routes({ [pr_lookup_path()]: '[]' }))

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(NO_PULL_REQUEST_MESSAGE)
	})

	// joshuafolkken/kit#1048: a rate-limited lookup used to reach the merge gate as "there is no pull
	// request for this branch", which sent the diagnosis after a pull request that plainly exists.
	it('says the lookup failed rather than that the branch has no pull request', async () => {
		mocked_api.mockRejectedValue(gh_failure())

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(UNREADABLE_PULL_REQUEST_MESSAGE)
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
