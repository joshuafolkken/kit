import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import {
	conditional_read_over,
	EMPTY_LISTING,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_lookup_path,
	PR_NUMBER,
	pr_routes,
} from './git-gh-pr-fixture'
import {
	forget_pr_numbers,
	git_gh_pr_read,
	UNREADABLE_PULL_REQUEST_MESSAGE,
} from './git-gh-pr-read'

// joshuafolkken/kit#7620: the branch → number lookup goes through the ETag layer, so a fresh process
// asking about a branch whose pull requests have not changed is answered 304, for free.

vi.mock('./git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

vi.mock('./git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_conditional = vi.mocked(git_gh_conditional.read_conditional)

function stub(routes: Parameters<typeof gh_api_routes>[0]): void {
	mocked_api.mockImplementation(gh_api_routes(routes))
}

beforeEach(() => {
	forget_pr_numbers()
	mocked_api.mockReset()
	mocked_conditional.mockReset()
	mocked_conditional.mockImplementation(conditional_read_over(mocked_api))
	shared_cache_fixture.keep_in_memory()
})

describe('the branch lookup through the ETag layer', () => {
	it('answers the same number from the kept listing when the next process is answered 304', async () => {
		stub(pr_routes({}))
		await expect(git_gh_pr_read.pr_get_number(PR_BRANCH)).resolves.toBe(PR_NUMBER)
		forget_pr_numbers()

		await expect(git_gh_pr_read.pr_get_number(PR_BRANCH)).resolves.toBe(PR_NUMBER)
		expect(await mocked_conditional.mock.results.at(-1)?.value).toEqual({ kind: 'unchanged' })
		expect(mocked_conditional.mock.calls.at(-1)?.[1]).toBeDefined()
	})

	it('reads an empty listing as no pull request', async () => {
		stub({ [pr_lookup_path()]: EMPTY_LISTING })

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).resolves.toBe(false)
	})

	it('reads a failed lookup as unreadable, not as no pull request', async () => {
		mocked_conditional.mockResolvedValue({ kind: 'unreadable', cause: gh_failure() })

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).rejects.toThrow(
			UNREADABLE_PULL_REQUEST_MESSAGE,
		)
	})
})
