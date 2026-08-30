import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_read } from './git-gh-issue-read'
import { CURRENT_REPO_ISSUES } from './git-gh-issue-rest-fixture'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#1039: the epic auto-close reads an epic's own comments to see whether a previous
// run already posted its closing announcement — the comment `issue_close` posts before it changes
// the state, and so the one a half-succeeded run leaves behind.
//
// Its own file rather than a section of `git-gh-issue-read.test.ts`, which is within a handful of
// lines of the three hundred a file may hold.
const ISSUE_NUMBER = '1039'
const COMMENTS_PATH = `${CURRENT_REPO_ISSUES}/${ISSUE_NUMBER}/comments`
const COMMENT_LISTING = '[{"body":"a plan comment"}]'
const READ_FAILED = 'API rate limit exceeded'

beforeEach(() => {
	vi.clearAllMocks()
})

describe('issue_list_comments', () => {
	// Paged, because the comment being looked for is the newest one while REST answers thirty rows. The
	// endpoint serves a bare array, which `--paginate` merges on its own — `--slurp` would wrap the
	// pages as `[[…],[…]]` and every array schema would then reject it, so the whole request is
	// asserted rather than only its path.
	it('reads the comments endpoint one full page at a time, and never slurped', async () => {
		mocked_api.mockResolvedValueOnce(COMMENT_LISTING)

		await expect(git_gh_issue_read.issue_list_comments(ISSUE_NUMBER)).resolves.toBe(COMMENT_LISTING)
		expect(mocked_api.mock.calls[0]?.[0]).toStrictEqual({
			path: `${COMMENTS_PATH}?per_page=100`,
			should_paginate: true,
		})
	})

	// `undefined` rather than `'[]'`: the caller has to tell "no announcement is there" from "nobody
	// looked", because posting on the second answer is the duplicate it exists to prevent.
	it('returns undefined when the read failed', async () => {
		mocked_api.mockRejectedValueOnce(new Error(READ_FAILED))

		await expect(git_gh_issue_read.issue_list_comments(ISSUE_NUMBER)).resolves.toBeUndefined()
	})
})
