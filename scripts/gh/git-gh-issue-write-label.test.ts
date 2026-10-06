import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#3312: a write that threw after the label landed refused a lane dispatch, so a
// throw is confirmed by reading the labels back before it counts as a failure.
const ISSUE_NUMBER = '3291'
const LABEL_NAME = 'in-progress'
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
const ISSUE_LABELS_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}/labels`
const WRITE_FAILED = 'gh: API rate limit exceeded (HTTP 403)'
const READ_FAILED = 'gh: timed out'

// The POST throws; the read-back answers what `read_back` does.
function serve_failed_write(read_back: () => Promise<string>): void {
	mocked_api.mockImplementation(async (request) => {
		if (request.body !== undefined) throw new Error(WRITE_FAILED)

		return await read_back()
	})
}

async function apply(): Promise<unknown> {
	return await git_gh_issue_write.issue_apply_label(ISSUE_NUMBER, LABEL_NAME)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_api.mockResolvedValue('')
})

describe('issue_apply_label', () => {
	it('reads nothing back when the write succeeds', async () => {
		expect(await apply()).toStrictEqual({ is_applied: true })
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	it('counts a thrown write as applied when the read-back finds the label', async () => {
		serve_failed_write(async () => `bug\n${LABEL_NAME}\n`)

		expect(await apply()).toStrictEqual({ is_applied: true })
		expect(mocked_api.mock.calls[1]?.[0]).toMatchObject({
			path: ISSUE_LABELS_PATH,
			should_paginate: true,
		})
	})

	it('answers the write error when the read-back does not find the label', async () => {
		serve_failed_write(async () => 'bug\n')

		expect(await apply()).toStrictEqual({ is_applied: false, reason: WRITE_FAILED })
	})

	it('keeps only the first line of the write error as the reason', async () => {
		mocked_api.mockRejectedValue(new Error(`${WRITE_FAILED}\n{"message":"Not Found"}`))

		expect(await apply()).toStrictEqual({ is_applied: false, reason: WRITE_FAILED })
	})

	it('answers the write error when the read-back itself fails', async () => {
		serve_failed_write(async () => {
			throw new Error(READ_FAILED)
		})

		expect(await apply()).toStrictEqual({ is_applied: false, reason: WRITE_FAILED })
	})

	it('keeps issue_add_label answering the same verdict as a boolean', async () => {
		serve_failed_write(async () => `${LABEL_NAME}\n`)

		expect(await git_gh_issue_write.issue_add_label(ISSUE_NUMBER, LABEL_NAME)).toBe(true)
	})
})
