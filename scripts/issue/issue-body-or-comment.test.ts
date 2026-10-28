import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_or_comment } from './issue-body-or-comment'

// joshuafolkken/kit#4134: the one place that decides whether a text fills an issue's body or becomes
// a comment, shared by `followup`'s completion notice and `issue:plan`.

const { issue_view_json, issue_edit_body, issue_comment } = vi.hoisted(() => ({
	issue_view_json:
		vi.fn<(issue_number: string, fields: string, repo?: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue_number: string, body: string, repo?: string) => Promise<string>>(),
	issue_comment: vi.fn<(issue_number: string, body: string, repo?: string) => Promise<string>>(),
}))

const { exec_gh_api } = vi.hoisted(() => ({
	exec_gh_api: vi.fn<(request: { path: string }) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_view_json, issue_edit_body, issue_comment },
}))

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api } }))

const ISSUE_NUMBER = '42'
const TEXT = '## Plan\n- step'
const BODY_URL = 'https://github.com/o/r/issues/42'
const COMMENT_URL = 'https://github.com/o/r/issues/42#issuecomment-1'
const OTHER_REPO = 'owner/other'
// `OWNER` and `NONE` are answered without a permission request; `MEMBER` is asked of the endpoint.
const TRUSTED = 'OWNER'
const UNTRUSTED = 'NONE'
const ASKED = 'MEMBER'

// Each test names its own login: a permission answer is remembered per login for the process.
function serve(body: string, association = TRUSTED, login = 'someone'): void {
	issue_view_json.mockResolvedValue(
		JSON.stringify({ body, author_association: association, user: { login } }),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	issue_edit_body.mockResolvedValue(BODY_URL)
	issue_comment.mockResolvedValue(COMMENT_URL)
})

describe('issue_body_or_comment.post — a blank body takes the text', () => {
	it.each(['', '   \n\t  '])('writes into the body when it is %j', async (body) => {
		serve(body)

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome).toStrictEqual({ destination: 'body', url: BODY_URL })
		expect(issue_edit_body).toHaveBeenCalledWith(ISSUE_NUMBER, TEXT, undefined)
		expect(issue_comment).not.toHaveBeenCalled()
	})
})

describe('issue_body_or_comment.post — anything else becomes a comment', () => {
	it('comments when the body has content', async () => {
		serve('  content  ')

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome).toStrictEqual({ destination: 'comment', url: COMMENT_URL })
		expect(issue_comment).toHaveBeenCalledWith(ISSUE_NUMBER, TEXT, undefined)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('comments when the body could not be read, so no unseen text is overwritten', async () => {
		issue_view_json.mockResolvedValue(undefined)

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome.destination).toBe('comment')
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('comments when the read is not an issue', async () => {
		issue_view_json.mockResolvedValue('{"message":"API rate limit exceeded"}')

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome.destination).toBe('comment')
	})

	it('comments when the blank body was filed by an author without write access (#4663)', async () => {
		serve('', UNTRUSTED)

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome).toStrictEqual({ destination: 'comment', url: COMMENT_URL })
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})

describe('issue_body_or_comment.post — a member without a write answer gets a comment', () => {
	it('comments when the write-access lookup for a member fails', async () => {
		serve('', ASKED, 'lookup-fails')
		exec_gh_api.mockRejectedValue(new Error('network'))

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome.destination).toBe('comment')
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('comments on another repository without asking this one about a member', async () => {
		serve('', ASKED, 'elsewhere')

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT, OTHER_REPO)

		expect(outcome).toStrictEqual({ destination: 'comment', url: COMMENT_URL })
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

describe('issue_body_or_comment.post — a member is asked for write access', () => {
	it('writes into the blank body of a member with write access', async () => {
		serve('', ASKED, 'writer')
		exec_gh_api.mockResolvedValue('{"permission":"write","role_name":"write"}')

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT)

		expect(outcome.destination).toBe('body')
		expect(exec_gh_api).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'repos/{owner}/{repo}/collaborators/writer/permission' }),
		)
	})

	it('writes into the blank body of an owner on another repository', async () => {
		serve('', TRUSTED)

		const outcome = await issue_body_or_comment.post(ISSUE_NUMBER, TEXT, OTHER_REPO)

		expect(outcome.destination).toBe('body')
		expect(issue_edit_body).toHaveBeenCalledWith(ISSUE_NUMBER, TEXT, OTHER_REPO)
	})
})
