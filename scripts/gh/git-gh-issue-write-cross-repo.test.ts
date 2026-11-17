import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#7695: an upstream interrupt's blocker lives in another repository, so its database
// id is read there while the relation is written on the finder here.
const ISSUE_NUMBER = '320'
const BLOCKER_NUMBER = '7691'
const BLOCKER_ID = 4_100_200_300
const UPSTREAM = 'joshuafolkken/kit'
const BLOCKED_BY_PATH = 'repos/{owner}/{repo}/issues/320/dependencies/blocked_by'

beforeEach(() => {
	mocked_api.mockReset()
	mocked_api.mockResolvedValueOnce(String(BLOCKER_ID)).mockResolvedValueOnce('')
})

describe('issue_add_blocked_by — a blocker in another repository', () => {
	it('resolves the blocker in its repository and writes the relation on this one', async () => {
		expect(
			await git_gh_issue_write.issue_add_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER, UPSTREAM),
		).toBe(true)

		const [resolve, write] = mocked_api.mock.calls.map(([request]) => request)

		expect(resolve?.path).toBe(`repos/${UPSTREAM}/issues/${BLOCKER_NUMBER}`)
		expect(write?.path).toBe(BLOCKED_BY_PATH)
		expect(JSON.parse(write?.body ?? '{}')).toStrictEqual({ issue_id: BLOCKER_ID })
	})
})
