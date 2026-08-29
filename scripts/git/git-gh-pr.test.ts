import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_pr } from './git-gh-pr'
import { gh_api_routes, PR_BRANCH, pr_lookup_path, pr_routes } from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
		exec_gh_api: vi.fn(),
	},
	has_stderr_field: (): boolean => false,
	BODY_FILE_FLAG: '--body-file',
	BODY_FROM_STDIN: '-',
}))

vi.mock('./git-command', () => ({
	git_command: { get_default_branch: vi.fn() },
}))

const mocked_command = vi.mocked(git_gh_exec.exec_gh_command)
const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

beforeEach(() => {
	vi.clearAllMocks()
	forget_pr_numbers()
	mocked_api.mockImplementation(gh_api_routes(pr_routes()))
	mocked_command.mockResolvedValue('')
})

function lookup_calls(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === pr_lookup_path()).length
}

// The branch → number memo the reads share is sound because a pull request's number never changes —
// except here, where `git-pr.ts` opens a second pull request on a branch whose first one merged. A
// memo left standing would keep answering with the merged one (joshuafolkken/kit#1027).
describe('pr_create drops the branch to number memo', () => {
	it('re-resolves the branch after a pull request is created', async () => {
		await git_gh_pr.pr_get_number(PR_BRANCH)
		await git_gh_pr.pr_create('title', 'body')
		await git_gh_pr.pr_get_number(PR_BRANCH)

		expect(lookup_calls()).toBe(2)
	})

	// The reads it clears are reached through the same namespace object, which is what makes the
	// memo one memo rather than one per import site.
	it('exposes the REST reads alongside the writes', () => {
		expect(typeof git_gh_pr.pr_get_review_comments).toBe('function')
	})
})
