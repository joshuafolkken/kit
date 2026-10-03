import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_read, NOT_FOUND_STATUS } from './git-gh-issue-read'
import { BLOCKER_NUMBER, ISSUE_NUMBER, rest_blockers } from './git-gh-issue-rest-fixture'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_status = vi.mocked(git_gh_exec.exec_gh_api_status)

const READ_NUMBER = String(ISSUE_NUMBER)
const RATE_LIMITED_STATUS = 429
const RATE_LIMIT_MESSAGE = 'API rate limit exceeded'

beforeEach(() => {
	vi.clearAllMocks()
})

// joshuafolkken/kit#1113: the relations read that does not consult the issue's summary count, for
// the one caller that has to know whether a relation is really absent rather than merely uncounted.
describe('issue_blocked_by_numbers', () => {
	it('answers the listing rather than the summary', async () => {
		mocked_api.mockResolvedValueOnce(rest_blockers())

		await expect(git_gh_issue_read.issue_blocked_by_numbers(READ_NUMBER)).resolves.toStrictEqual([
			BLOCKER_NUMBER,
		])
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	// `read_blocked_by` skips a pull request structurally (joshuafolkken/kit#1066); this entry point
	// has no issue payload to make that call from, so it reads the endpoint's own answer instead. A
	// pull request pasted into an epic's task list must not become a warning about a lost relation.
	it('answers no relations when the endpoint has nothing at that number', async () => {
		mocked_api.mockRejectedValueOnce(new Error('not found'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await expect(git_gh_issue_read.issue_blocked_by_numbers(READ_NUMBER)).resolves.toStrictEqual([])
	})

	// A rate limit is a gap, not an answer: swallowing it would report a real relation as absent.
	it('raises when the read failed over something other than the number', async () => {
		mocked_api.mockRejectedValueOnce(new Error(RATE_LIMIT_MESSAGE))
		mocked_status.mockResolvedValueOnce(RATE_LIMITED_STATUS)

		await expect(git_gh_issue_read.issue_blocked_by_numbers(READ_NUMBER)).rejects.toThrow(
			RATE_LIMIT_MESSAGE,
		)
	})
})
