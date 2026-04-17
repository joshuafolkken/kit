// cspell:words coderabbit coderabbitai
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handle_ai_review_findings, type TelegramContext } from './git-pr-ai-review'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		pr_get_comments: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('./telegram-notify', () => ({
	telegram_notify: {
		send: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const { telegram_notify } = await import('./telegram-notify')
const mocked_pr_get_comments = vi.mocked(git_gh_command.pr_get_comments)
const mocked_pr_comment = vi.mocked(git_gh_command.pr_comment)
const mocked_telegram_send = vi.mocked(telegram_notify.send)

const BRANCH = 'feature-branch'
const IGNORE_REASON = 'Tracked in follow-up Issue #999'
const CONTEXT: TelegramContext = {
	repo_name: 'joshuafolkken-com',
	issue_title: 'Fix bug',
	issue_url: 'https://github.com/owner/repo/issues/1',
	pr_url: 'https://github.com/owner/repo/pull/2',
}

const CLAUDE_BLOCKER_COMMENT = {
	author: { login: 'claude' },
	body: '## Code Review\n\n### Issues\n\n#### Logic bug — oops\n\n```ts\nconst x = 1\n```',
	url: 'https://github.com/owner/repo/pull/2#issuecomment-1',
}

const CLAUDE_CLEAN_COMMENT = {
	author: { login: 'claude' },
	body: '## Code Review\n\nAll previous issues are resolved ✓',
	url: 'https://github.com/owner/repo/pull/2#issuecomment-2',
}

const BLOCKER_MESSAGE_REGEX = /AI reviewer findings remain unresolved/u

beforeEach(() => {
	vi.clearAllMocks()
})

describe('handle_ai_review_findings — no blockers', () => {
	it('returns without side effects when the classifier finds nothing', async () => {
		mocked_pr_get_comments.mockResolvedValue(JSON.stringify([CLAUDE_CLEAN_COMMENT]))

		await handle_ai_review_findings({
			branch_name: BRANCH,
			ignore_reason: undefined,
			context: CONTEXT,
		})

		expect(mocked_pr_comment).not.toHaveBeenCalled()
		expect(mocked_telegram_send).not.toHaveBeenCalled()
	})
})

describe('handle_ai_review_findings — blocker without ignore reason', () => {
	it('sends a confirmation Telegram and throws', async () => {
		mocked_pr_get_comments.mockResolvedValue(JSON.stringify([CLAUDE_BLOCKER_COMMENT]))

		await expect(
			handle_ai_review_findings({
				branch_name: BRANCH,
				ignore_reason: undefined,
				context: CONTEXT,
			}),
		).rejects.toThrow(BLOCKER_MESSAGE_REGEX)
		expect(mocked_telegram_send).toHaveBeenCalledTimes(1)
		const [send_input] = mocked_telegram_send.mock.calls[0] ?? []

		expect(send_input?.task_type).toBe('confirmation')
		expect(send_input?.body).toContain('claude')
		expect(mocked_pr_comment).not.toHaveBeenCalled()
	})

	it('treats whitespace-only ignore_reason as missing and still throws', async () => {
		mocked_pr_get_comments.mockResolvedValue(JSON.stringify([CLAUDE_BLOCKER_COMMENT]))

		await expect(
			handle_ai_review_findings({
				branch_name: BRANCH,
				ignore_reason: '   ',
				context: CONTEXT,
			}),
		).rejects.toThrow(BLOCKER_MESSAGE_REGEX)
		expect(mocked_telegram_send).toHaveBeenCalledTimes(1)
		expect(mocked_pr_comment).not.toHaveBeenCalled()
	})
})

describe('handle_ai_review_findings — blocker with ignore reason', () => {
	it('posts an ignore-reason comment and proceeds without sending Telegram', async () => {
		mocked_pr_get_comments.mockResolvedValue(JSON.stringify([CLAUDE_BLOCKER_COMMENT]))
		mocked_pr_comment.mockResolvedValue('')

		await handle_ai_review_findings({
			branch_name: BRANCH,
			ignore_reason: IGNORE_REASON,
			context: CONTEXT,
		})

		expect(mocked_pr_comment).toHaveBeenCalledTimes(1)
		const [branch, body] = mocked_pr_comment.mock.calls[0] ?? []

		expect(branch).toBe(BRANCH)
		expect(body).toContain('intentionally left unresolved')
		expect(body).toContain(IGNORE_REASON)
		expect(mocked_telegram_send).not.toHaveBeenCalled()
	})
})
