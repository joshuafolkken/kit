import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import {
	EMPTY_LISTING,
	gh_api_routes,
	gh_failure,
	GH_FAILURE,
	PR_BRANCH,
	pr_detail_path,
	pr_lookup_path,
	pr_routes,
	rest_pull_page,
	too_many_files_failure,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import {
	forget_pr_numbers,
	git_gh_pr_read,
	UNREADABLE_PULL_REQUEST_MESSAGE,
} from './git-gh-pr-read'

// joshuafolkken/kit#3263: a failed read answered exactly what a branch with no pull request did, and
// one command read the same pull request's detail once per reader.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_command: vi.fn(), exec_gh_api: vi.fn() },
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const PR_BODY = 'closes #3263'
const MERGED_AT = '2026-10-06T00:00:00Z'
const OTHER_STATUS = 400
const NEWER_PR_NUMBER = 973

function stub(routes: Record<string, GhApiAnswer>): void {
	mocked_api.mockImplementation(gh_api_routes(routes))
}

// The lookup answers `lookup`, and the detail read behind it fails with `failure`.
function stub_failed_detail(failure: Error, lookup = rest_pull_page([{}])): void {
	stub(
		pr_routes(
			{},
			{
				[pr_lookup_path()]: lookup,
				[pr_detail_path()]: async () => {
					throw failure
				},
			},
		),
	)
}

function calls_to(path: string): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === path).length
}

function detail_calls(): number {
	return calls_to(pr_detail_path())
}

function lookup_calls(): number {
	return calls_to(pr_lookup_path())
}

beforeEach(() => {
	vi.clearAllMocks()
	forget_pr_numbers()
})

describe('pr_view tells an unreadable pull request from a missing one', () => {
	it('answers the empty string only when the branch has no pull request', async () => {
		stub({ [pr_lookup_path()]: EMPTY_LISTING })

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).resolves.toBe('')
	})

	it('throws when the lookup could not be read', async () => {
		mocked_api.mockRejectedValue(gh_failure())

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).rejects.toThrow(UNREADABLE_PULL_REQUEST_MESSAGE)
	})

	it('carries the failed detail read as the cause', async () => {
		const failure = gh_failure()

		stub_failed_detail(failure)

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).rejects.toThrow(
			expect.objectContaining({ cause: failure }) as Error,
		)
	})

	// joshuafolkken/kit#5226: the preflight prints the message alone, so the cause has to be in it.
	it('names the cause in the message', async () => {
		stub_failed_detail(gh_failure())

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).rejects.toThrow(
			`${UNREADABLE_PULL_REQUEST_MESSAGE}: ${PR_BRANCH} (${GH_FAILURE})`,
		)
	})
})

// joshuafolkken/kit#5226: GitHub refuses some pull requests' single-pull JSON with 422 "too many files
// changed" while the listing answers for the same one.
describe('a detail read refused as too many files changed', () => {
	it('answers pr_view from the listing row, with the merge state unknown', async () => {
		stub_failed_detail(too_many_files_failure())

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).resolves.toBe(JSON.stringify({ state: 'OPEN' }))
	})

	it('answers the merge state from a merged listing row', async () => {
		stub_failed_detail(
			too_many_files_failure(),
			rest_pull_page([{ state: 'closed', merged_at: MERGED_AT }]),
		)

		await expect(git_gh_pr_read.pr_get_merge_state(PR_BRANCH)).resolves.toMatchObject({
			is_merged: true,
			merged_at: MERGED_AT,
			merge_state_status: undefined,
		})
	})
})

describe('a failed detail read the listing does not stand in for', () => {
	it.each([
		['any other failure', gh_failure()],
		['a 422 about something else', too_many_files_failure(OTHER_STATUS)],
	])('stays unreadable on %s', async (_label, failure) => {
		stub_failed_detail(failure)

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).rejects.toThrow(
			expect.objectContaining({ cause: failure }) as Error,
		)
		expect(lookup_calls()).toBe(1)
	})

	it.each([
		['is empty', EMPTY_LISTING],
		['names a newer pull request', rest_pull_page([{ number: NEWER_PR_NUMBER }])],
	])('stays unreadable when the listing %s', async (_label, listing) => {
		const failure = too_many_files_failure()

		stub_failed_detail(failure)
		await git_gh_pr_read.pr_get_number(PR_BRANCH)
		stub_failed_detail(failure, listing)

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).rejects.toThrow(
			expect.objectContaining({ cause: failure }) as Error,
		)
	})
})

describe('the detail read is remembered for the command', () => {
	it('reads one pull request once for every reader', async () => {
		stub(pr_routes())

		await git_gh_pr_read.pr_get_url(PR_BRANCH)
		await git_gh_pr_read.pr_get_body(PR_BRANCH)

		expect(detail_calls()).toBe(1)
	})

	it('shares one request between readers in the same tick', async () => {
		stub(pr_routes())

		await Promise.all([git_gh_pr_read.pr_get_url(PR_BRANCH), git_gh_pr_read.pr_get_body(PR_BRANCH)])

		expect(detail_calls()).toBe(1)
	})

	it('reads again after the memo is cleared', async () => {
		stub(pr_routes())

		await git_gh_pr_read.pr_get_body(PR_BRANCH)
		forget_pr_numbers()
		await git_gh_pr_read.pr_get_body(PR_BRANCH)

		expect(detail_calls()).toBe(2)
	})
})

describe('what the detail memo does not keep', () => {
	it('does not remember a detail read that failed', async () => {
		stub_failed_detail(gh_failure())
		await git_gh_pr_read.pr_get_body(PR_BRANCH)
		stub(pr_routes({ body: PR_BODY }))

		await expect(git_gh_pr_read.pr_get_body(PR_BRANCH)).resolves.toBe(PR_BODY)
		expect(detail_calls()).toBe(2)
	})

	// `josh ship` asks it again after each merge it pushes, so a remembered answer would keep
	// reporting the conflict that merge resolved.
	it('reads the merge state fresh every time', async () => {
		stub(pr_routes())

		await git_gh_pr_read.pr_get_body(PR_BRANCH)
		await git_gh_pr_read.pr_get_merge_state(PR_BRANCH)
		await git_gh_pr_read.pr_get_merge_state(PR_BRANCH)

		expect(detail_calls()).toBe(3)
	})

	// `josh git -y` reads the body at its preflight and the state only after its commit and push, so
	// a remembered answer would report a pull request merged in between as still open.
	it('reports a merge made after an earlier read of the same pull request', async () => {
		stub(pr_routes())
		await git_gh_pr_read.pr_get_body(PR_BRANCH)
		stub(pr_routes({ state: 'closed', merged_at: MERGED_AT }))

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).resolves.toContain('"state":"MERGED"')
	})
})
