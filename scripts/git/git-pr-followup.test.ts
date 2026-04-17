import { beforeEach, describe, expect, it, vi } from 'vitest'
import { is_blank_issue_body, post_notify_issue } from './git-pr-followup'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_body: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_comment: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const mocked_get_body = vi.mocked(git_gh_command.issue_get_body)
const mocked_edit_body = vi.mocked(git_gh_command.issue_edit_body)
const mocked_comment = vi.mocked(git_gh_command.issue_comment)

describe('is_blank_issue_body', () => {
	it('returns true for undefined', () => {
		// eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing undefined input
		expect(is_blank_issue_body(undefined)).toBe(true)
	})

	it('returns true for empty string', () => {
		expect(is_blank_issue_body('')).toBe(true)
	})

	it('returns true for whitespace-only string', () => {
		expect(is_blank_issue_body('   \n\t  ')).toBe(true)
	})

	it('returns false for non-empty body', () => {
		expect(is_blank_issue_body('## Background\nSome content')).toBe(false)
	})

	it('returns false for body with leading whitespace and content', () => {
		expect(is_blank_issue_body('  content  ')).toBe(false)
	})
})

describe('post_notify_issue — blank body uses edit, non-blank uses comment', () => {
	const ISSUE_NUMBER = '42'
	const NOTIFY_BODY = 'Completion notification'

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('calls issue_edit_body when issue body is blank', async () => {
		mocked_get_body.mockResolvedValue('')
		mocked_edit_body.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_edit_body).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_comment).not.toHaveBeenCalled()
	})

	it('calls issue_comment when issue body is non-blank', async () => {
		mocked_get_body.mockResolvedValue('existing content')
		mocked_comment.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_comment).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_edit_body).not.toHaveBeenCalled()
	})

	it('falls back to issue_comment when body fetch fails (undefined)', async () => {
		// eslint-disable-next-line unicorn/no-useless-undefined -- simulating API failure returning undefined
		mocked_get_body.mockResolvedValue(undefined)
		mocked_comment.mockResolvedValue('')

		await post_notify_issue({ issue_number: ISSUE_NUMBER, body: NOTIFY_BODY })

		expect(mocked_comment).toHaveBeenCalledWith(ISSUE_NUMBER, NOTIFY_BODY)
		expect(mocked_edit_body).not.toHaveBeenCalled()
	})

	it('throws when issue_number is undefined', async () => {
		await expect(post_notify_issue({ issue_number: undefined, body: NOTIFY_BODY })).rejects.toThrow(
			'Issue number is required for issue notification.',
		)
	})
})
