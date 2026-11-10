import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_memo } from './git-gh-issue-memo'
import { git_gh_issue_read } from './git-gh-issue-read'
import { ISSUE_NUMBER, rest_issue } from './git-gh-issue-rest-fixture'
import { git_gh_issue_write } from './git-gh-issue-write'
import { forget_pr_numbers } from './git-gh-pr-read'

// joshuafolkken/kit#7141: one process read the same issue once per reader, a request each.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

vi.mock('./git-gh-etag-read', () => ({
	git_gh_etag_read: { read: async (path: string) => await git_gh_exec.exec_gh_api({ path }) },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const READ_NUMBER = String(ISSUE_NUMBER)
const OTHER_NUMBER = '7142'

// The GETs of one issue, the request this memo exists to remove.
function issue_gets(): number {
	return mocked_api.mock.calls.filter(([request]) => request.method === undefined).length
}

beforeEach(() => {
	git_gh_issue_memo.forget()
	mocked_api.mockReset()
	mocked_api.mockResolvedValue(rest_issue())
})

afterEach(() => {
	vi.useRealTimers()
})

describe('git_gh_issue_memo — one process reads one issue once', () => {
	it('answers a second read of the same issue without a request', async () => {
		await git_gh_issue_read.issue_get_title(READ_NUMBER)
		await git_gh_issue_read.issue_view_json(READ_NUMBER, 'state,labels')

		expect(issue_gets()).toBe(1)
	})

	it('shares the request in flight between readers in one tick', async () => {
		await Promise.all([
			git_gh_issue_read.issue_get_title(READ_NUMBER),
			git_gh_issue_read.issue_get_body(READ_NUMBER),
		])

		expect(issue_gets()).toBe(1)
	})

	it('reads another issue on its own', async () => {
		await git_gh_issue_read.issue_get_title(READ_NUMBER)
		await git_gh_issue_read.issue_get_title(OTHER_NUMBER)

		expect(issue_gets()).toBe(2)
	})

	it('does not remember a read that failed', async () => {
		mocked_api.mockRejectedValueOnce(new Error('gh: rate limited'))

		await expect(git_gh_issue_read.issue_get_title(READ_NUMBER)).resolves.toBeUndefined()
		await expect(git_gh_issue_read.issue_get_title(READ_NUMBER)).resolves.toBeDefined()
		expect(issue_gets()).toBe(2)
	})

	it('reads again once the answer is older than FRESH_MS', async () => {
		vi.useFakeTimers()
		await git_gh_issue_read.issue_get_title(READ_NUMBER)
		vi.advanceTimersByTime(git_gh_issue_memo.FRESH_MS)
		await git_gh_issue_read.issue_get_title(READ_NUMBER)

		expect(issue_gets()).toBe(2)
	})
})

describe('git_gh_issue_memo — a write makes the next read ask again', () => {
	it('reads again after an issue write', async () => {
		await git_gh_issue_read.issue_get_body(READ_NUMBER)
		await git_gh_issue_write.issue_edit_body(READ_NUMBER, 'edited')
		await git_gh_issue_read.issue_get_body(READ_NUMBER)

		expect(issue_gets()).toBe(2)
	})

	it('reads again after a write that threw, since it may have landed', async () => {
		await git_gh_issue_read.issue_get_body(READ_NUMBER)
		mocked_api.mockRejectedValueOnce(new Error('gh: timed out'))
		await expect(
			git_gh_issue_write.issue_remove_label(READ_NUMBER, 'in-progress'),
		).rejects.toThrow()
		await git_gh_issue_read.issue_get_body(READ_NUMBER)

		expect(issue_gets()).toBe(2)
	})

	it('reads again after a pull-request write clears the pull-request memos', async () => {
		await git_gh_issue_read.issue_get_body(READ_NUMBER)
		forget_pr_numbers()
		await git_gh_issue_read.issue_get_body(READ_NUMBER)

		expect(issue_gets()).toBe(2)
	})
})
