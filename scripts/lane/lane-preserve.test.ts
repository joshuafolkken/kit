import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_preserve } from './lane-preserve'

// joshuafolkken/kit#3772: `run:merge` and `lane:restart` keep a lane's uncommitted work through one
// writer. The stash and the Issue comment are mocked, so what is pinned is the message the push uses,
// the recovery line the comment names, and that a failed push throws before anything is announced.

vi.mock('#scripts/git/stash/git-stash', () => ({
	git_stash: {
		push: vi.fn(),
		work_message(issue: string, occasion: string): string {
			return `${issue}: uncommitted work at ${occasion}`
		},
	},
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_try_comment: vi.fn() },
}))

const { git_stash } = await import('#scripts/git/stash/git-stash')
const { git_gh_issue_write } = await import('#scripts/gh/git-gh-issue-write')
const push = vi.mocked(git_stash.push)
const comment = vi.mocked(git_gh_issue_write.issue_try_comment)

const MESSAGE = '3772: uncommitted work at restart'
const CAUSE = 'it was restarted'
const FAILURE = 'stash failed'

beforeEach(() => {
	push.mockReset()
	comment.mockReset()
})

describe('lane_preserve.stash_work — stash the lane, then say where on the Issue', () => {
	it('pushes under the issue and occasion, and returns the message', async () => {
		const message = await lane_preserve.stash_work('3772', '/lane', 'restart', CAUSE)

		expect(message).toBe(MESSAGE)
		expect(push).toHaveBeenCalledWith(MESSAGE, '/lane')
	})

	it('comments the cause and the stash:pop line that recovers the work', async () => {
		await lane_preserve.stash_work('3772', '/lane', 'restart', CAUSE)

		const [issue, body] = comment.mock.calls[0] ?? []

		expect(issue).toBe('3772')
		expect(body).toContain('uncommitted work when it was restarted, so it was stashed')
		expect(body).toContain(`pnpm josh stash:pop "${MESSAGE}"`)
	})

	it('throws a failed push and announces nothing, so the caller keeps the tree', async () => {
		push.mockRejectedValue(new Error(FAILURE))

		await expect(lane_preserve.stash_work('3772', '/lane', 'restart', CAUSE)).rejects.toThrow(
			FAILURE,
		)
		expect(comment).not.toHaveBeenCalled()
	})
})
