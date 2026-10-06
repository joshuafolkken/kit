import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import {
	EMPTY_LISTING,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_detail_path,
	pr_lookup_path,
	pr_routes,
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

function stub(routes: Record<string, GhApiAnswer>): void {
	mocked_api.mockImplementation(gh_api_routes(routes))
}

// The lookup resolves, and the detail read behind it fails with `failure`.
function stub_failed_detail(failure: Error): void {
	stub(
		pr_routes(
			{},
			{
				[pr_detail_path()]: async () => {
					throw failure
				},
			},
		),
	)
}

function detail_calls(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === pr_detail_path()).length
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
