import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { CURRENT_REPO_ISSUES, rest_issue } from '#scripts/gh/git-gh-issue-rest-fixture'
import { too_many_files_failure } from '#scripts/gh/git-gh-pr-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5241: a pull request GitHub refuses to serve as too many files changed is read
// through the issue endpoint, which carries its body and merge time.

const PR = 5222
const ISSUE = 5216
const MERGED_AT = '2026-10-27T09:00:00Z'

vi.mock('#scripts/gh/git-gh-pr-read', () => ({ read_pull: vi.fn() }))

const { read_pull } = await import('#scripts/gh/git-gh-pr-read')
const { issue_sample_gate } = await import('./issue-sample-gate')

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_sample_gate.read_source on a pull request too large to read', () => {
	it('reads the body and the merge time from the issue endpoint', async () => {
		const served = rest_issue({
			number: PR,
			body: `closes #${String(ISSUE)}`,
			pull_request: { merged_at: MERGED_AT },
		})

		vi.mocked(read_pull).mockRejectedValue(too_many_files_failure())
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(served)

		expect(await issue_sample_gate.read_source(PR)).toStrictEqual({
			merged_at: MERGED_AT,
			closes: ISSUE,
		})
		expect(exec).toHaveBeenCalledWith({ path: `${CURRENT_REPO_ISSUES}/${String(PR)}` })
	})

	it('rethrows any other failure of the pull request read', async () => {
		const failure = new Error('gh: HTTP 502')

		vi.mocked(read_pull).mockRejectedValue(failure)
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api')

		await expect(issue_sample_gate.read_source(PR)).rejects.toBe(failure)
		expect(exec).not.toHaveBeenCalled()
	})
})
