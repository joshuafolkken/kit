import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { CURRENT_REPO_ISSUES, rest_issue } from '#scripts/gh/git-gh-issue-rest-fixture'
import { too_many_files_failure } from '#scripts/gh/git-gh-pr-fixture'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_sample_prime } from './issue-sample-prime'

// joshuafolkken/kit#5241: a pull request GitHub refuses to serve as too many files changed is read
// through the issue endpoint, which carries its body and merge time. joshuafolkken/kit#7618: the pull
// request read goes through the ETag layer, so an unchanged one answers from the kept body.

const PR = 5222
const ISSUE = 5216
const MERGED_AT = '2026-10-27T09:00:00Z'
const ETAG = 'W/"pull"'
const SOURCE = { merged_at: MERGED_AT, closes: ISSUE }

function answer_with(...answers: Array<ConditionalRead>): void {
	const mocked = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) mocked.mockResolvedValueOnce(answer)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
})

describe('issue_sample_prime.read_source through the ETag layer', () => {
	it('answers an unchanged pull request from the previous body', async () => {
		const body = JSON.stringify({
			number: PR,
			body: `closes #${String(ISSUE)}`,
			merged_at: MERGED_AT,
		})

		answer_with({ kind: 'changed', etag: ETAG, body }, { kind: 'unchanged' })

		expect(await issue_sample_prime.read_source(PR)).toStrictEqual(SOURCE)
		expect(await issue_sample_prime.read_source(PR)).toStrictEqual(SOURCE)
		expect(git_gh_conditional.read_conditional).toHaveBeenLastCalledWith(
			git_gh_api_path.pull_api_path(String(PR)),
			ETAG,
			undefined,
		)
	})
})

describe('issue_sample_prime.read_source on a pull request too large to read', () => {
	it('reads the body and the merge time from the issue endpoint', async () => {
		const served = rest_issue({
			number: PR,
			body: `closes #${String(ISSUE)}`,
			pull_request: { merged_at: MERGED_AT },
		})

		answer_with({ kind: 'unreadable', cause: too_many_files_failure() })
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(served)

		expect(await issue_sample_prime.read_source(PR)).toStrictEqual(SOURCE)
		expect(exec).toHaveBeenCalledWith({ path: `${CURRENT_REPO_ISSUES}/${String(PR)}` })
	})

	it('rethrows any other failure of the pull request read', async () => {
		const failure = new Error('gh: HTTP 502')

		answer_with({ kind: 'unreadable', cause: failure })
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api')

		await expect(issue_sample_prime.read_source(PR)).rejects.toBe(failure)
		expect(exec).not.toHaveBeenCalled()
	})
})
