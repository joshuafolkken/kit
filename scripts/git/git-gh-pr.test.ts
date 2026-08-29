import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_pr } from './git-gh-pr'
import { git_gh_repo } from './git-gh-repo'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_command: vi.fn(), exec_gh_api: vi.fn() },
	has_stderr_field: (): boolean => false,
	BODY_FILE_FLAG: '--body-file',
	BODY_FROM_STDIN: '-',
}))

vi.mock('./git-gh-repo', () => ({
	git_gh_repo: { repo_get_name_with_owner: vi.fn() },
}))

const mocked_command = vi.mocked(git_gh_exec.exec_gh_command)
const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_repo = vi.mocked(git_gh_repo.repo_get_name_with_owner)

const BRANCH = 'feature-branch'
const REPO = 'joshuafolkken/kit'
const PR_NUMBER = '972'
const EMPTY_LISTING = '[]'
const GH_FAILURE = 'gh exploded'
const RETURNS_LISTING = 'returns the listing gh printed'
const REPORTS_FAILURE = 'reports a failed read rather than answering with an empty listing'

beforeEach(() => {
	vi.clearAllMocks()
	mocked_repo.mockResolvedValue(REPO)
})

// joshuafolkken/kit#973: both readers turned every failure into the string `'[]'`, which the merge
// gate then read as "no reviewer left a finding". A rate limit reaching the gate as an answer is how
// a PR merged with the gate never actually read.
describe('pr_get_comments', () => {
	it(RETURNS_LISTING, async () => {
		mocked_command.mockResolvedValueOnce(EMPTY_LISTING)

		await expect(git_gh_pr.pr_get_comments(BRANCH)).resolves.toBe(EMPTY_LISTING)
	})

	it(REPORTS_FAILURE, async () => {
		mocked_command.mockRejectedValueOnce(new Error(GH_FAILURE))

		await expect(git_gh_pr.pr_get_comments(BRANCH)).resolves.toBeUndefined()
	})
})

describe('pr_get_review_comments', () => {
	it(RETURNS_LISTING, async () => {
		mocked_command.mockResolvedValueOnce(PR_NUMBER)
		mocked_api.mockResolvedValueOnce(EMPTY_LISTING)

		await expect(git_gh_pr.pr_get_review_comments(BRANCH)).resolves.toBe(EMPTY_LISTING)
	})

	// The request goes through `exec_gh_api` and its path through `git_gh_api_path` since
	// joshuafolkken/kit#1023, rather than being concatenated here; what they produce has to stay
	// byte-for-byte the path gh was asked for before.
	it('asks gh for the review comments of that pull request', async () => {
		mocked_command.mockResolvedValueOnce(PR_NUMBER)
		mocked_api.mockResolvedValueOnce(EMPTY_LISTING)

		await git_gh_pr.pr_get_review_comments(BRANCH)

		expect(mocked_api).toHaveBeenCalledWith({
			path: `repos/${REPO}/pulls/${PR_NUMBER}/comments`,
		})
	})

	it(REPORTS_FAILURE, async () => {
		mocked_command.mockResolvedValueOnce(PR_NUMBER)
		mocked_api.mockRejectedValueOnce(new Error(GH_FAILURE))

		await expect(git_gh_pr.pr_get_review_comments(BRANCH)).resolves.toBeUndefined()
	})

	// Not knowing which pull request to ask about is a gap too: nothing was read either way.
	it('reports a repository name it could not resolve', async () => {
		mocked_repo.mockResolvedValue(undefined)
		mocked_command.mockResolvedValueOnce(PR_NUMBER)

		await expect(git_gh_pr.pr_get_review_comments(BRANCH)).resolves.toBeUndefined()
	})

	it('reports a pull request number it could not resolve', async () => {
		mocked_command.mockRejectedValueOnce(new Error(GH_FAILURE))

		await expect(git_gh_pr.pr_get_review_comments(BRANCH)).resolves.toBeUndefined()
	})
})
