import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_or_comment } from './issue-body-or-comment'

// joshuafolkken/kit#4134: the one place that decides whether a text fills an issue's body or becomes
// a comment, shared by `followup`'s completion notice and `issue:plan`.

const { issue_get_body, issue_edit_body, issue_comment } = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue_number: string, repo?: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue_number: string, body: string, repo?: string) => Promise<string>>(),
	issue_comment: vi.fn<(issue_number: string, body: string, repo?: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body, issue_edit_body, issue_comment },
}))

const ISSUE_NUMBER = '42'
const TEXT = '## Plan\n- step'
const BODY_URL = 'https://github.com/o/r/issues/42'
const COMMENT_URL = 'https://github.com/o/r/issues/42#issuecomment-1'

beforeEach(() => {
	vi.clearAllMocks()
	issue_edit_body.mockResolvedValue(BODY_URL)
	issue_comment.mockResolvedValue(COMMENT_URL)
})

describe('issue_body_or_comment.post — a blank body takes the text', () => {
	it.each(['', '   \n\t  '])('writes into the body when it is %j', async (body) => {
		issue_get_body.mockResolvedValue(body)

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome).toStrictEqual({ destination: 'body', url: BODY_URL })
		expect(issue_edit_body).toHaveBeenCalledWith(ISSUE_NUMBER, TEXT, undefined)
		expect(issue_comment).not.toHaveBeenCalled()
	})
})

describe('issue_body_or_comment.post — anything else becomes a comment', () => {
	it('comments when the body has content', async () => {
		issue_get_body.mockResolvedValue('  content  ')

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome).toStrictEqual({ destination: 'comment', url: COMMENT_URL })
		expect(issue_comment).toHaveBeenCalledWith(ISSUE_NUMBER, TEXT, undefined)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('comments when the body could not be read, so no unseen text is overwritten', async () => {
		issue_get_body.mockResolvedValue(undefined)

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome.destination).toBe('comment')
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})
