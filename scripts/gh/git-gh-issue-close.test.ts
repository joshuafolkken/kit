import { describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

// joshuafolkken/kit#3908: a withdrawn issue closes as not planned — the reason `issue-merged.ts` reads
// as no merge — so it is never taken for one whose work landed.

const ISSUE_NUMBER = '3769'
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
const ISSUE_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}`
const COMMENT = 'Withdrawn by a person.'

function requests(): Array<GhApiRequest> {
	return vi.mocked(git_gh_exec.exec_gh_api).mock.calls.map(([request]) => request)
}

describe('git_gh_issue_write.issue_close_not_planned', () => {
	it('posts the comment first, then closes the issue as not planned', async () => {
		const is_closed = await git_gh_issue_write.issue_close_not_planned(ISSUE_NUMBER, COMMENT)
		const [comment, close] = requests()

		expect(is_closed).toBe(true)
		expect(comment?.path).toBe(`${ISSUE_PATH}/comments`)
		expect(close).toMatchObject({ path: ISSUE_PATH, method: 'PATCH' })
		expect(JSON.parse(close?.body ?? '{}')).toStrictEqual({
			state: 'closed',
			state_reason: 'not_planned',
		})
	})
})
