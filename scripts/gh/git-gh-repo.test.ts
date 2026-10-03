import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_repo } from './git-gh-repo'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO = 'joshuafolkken/kit'

beforeEach(() => {
	vi.clearAllMocks()
})

// joshuafolkken/kit#1023: `gh repo view --json nameWithOwner` goes through GraphQL, which a cloud
// session is refused (403). The same fact is repository-scoped REST, which is allowed.
describe('repo_get_name_with_owner', () => {
	it('reads the name through gh api rather than gh repo view', async () => {
		mocked_api.mockResolvedValueOnce(REPO)

		await git_gh_repo.repo_get_name_with_owner()

		expect(mocked_api).toHaveBeenCalledWith({
			path: 'repos/{owner}/{repo}',
			jq_filter: '.full_name',
		})
	})

	it('returns the name gh printed', async () => {
		mocked_api.mockResolvedValueOnce(REPO)

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBe(REPO)
	})

	it('trims whitespace off the name', async () => {
		mocked_api.mockResolvedValueOnce(`  ${REPO}\n`)

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBe(REPO)
	})

	// The failure contract is what the callers depend on, and converting the call must not change it.
	it('returns undefined when the request fails', async () => {
		mocked_api.mockRejectedValueOnce(new Error('gh: Not Found'))

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBeUndefined()
	})

	it('returns undefined when the response is empty', async () => {
		mocked_api.mockResolvedValueOnce('')

		await expect(git_gh_repo.repo_get_name_with_owner()).resolves.toBeUndefined()
	})
})
