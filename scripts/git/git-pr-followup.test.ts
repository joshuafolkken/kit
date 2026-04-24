import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	build_telegram_input,
	git_pr_followup,
	is_blank_issue_body,
	parse_repo_name,
	post_notify_issue,
	type FollowupInput,
	type TelegramContext,
} from './git-pr-followup'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_body: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_comment: vi.fn(),
		repo_get_name_with_owner: vi.fn(),
		issue_get_title: vi.fn(),
		pr_get_url: vi.fn(),
		pr_get_review_comments: vi.fn(),
		pr_get_comments: vi.fn(),
		pr_merge: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('./git-pr-checks', () => ({
	git_pr_checks: {
		wait_for_pr_success: vi.fn(),
	},
}))

vi.mock('./git-pr-ai-review', () => ({
	git_pr_ai_review: {
		handle_ai_review_findings: vi.fn(),
	},
}))

vi.mock('./telegram-notify', () => ({
	telegram_notify: {
		send: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const { git_pr_checks } = await import('./git-pr-checks')
const { git_pr_ai_review } = await import('./git-pr-ai-review')
const { telegram_notify } = await import('./telegram-notify')

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

describe('parse_repo_name', () => {
	it('returns the repo name from owner/repo format', () => {
		expect(parse_repo_name('joshuafolkken/tasks')).toBe('tasks')
	})

	it('returns undefined when input is undefined', () => {
		const input: string | undefined = undefined

		expect(parse_repo_name(input)).toBeUndefined()
	})
})

describe('build_telegram_input', () => {
	const CONTEXT: TelegramContext = {
		repo_name: 'joshuafolkken-com',
		issue_title: 'Fix bug',
		issue_url: 'https://github.com/owner/repo/issues/1',
		pr_url: 'https://github.com/owner/repo/pull/2',
	}

	it('forwards context fields and task_type onto the send input', () => {
		const result = build_telegram_input({
			task_type: 'completion',
			context: CONTEXT,
			body: undefined,
		})

		expect(result).toStrictEqual({
			task_type: 'completion',
			repo_name: CONTEXT.repo_name,
			issue_title: CONTEXT.issue_title,
			body: undefined,
			issue_url: CONTEXT.issue_url,
			pr_url: CONTEXT.pr_url,
		})
	})
})

const PR_URL = 'https://github.com/owner/repo/pull/1'

const BASE_INPUT: FollowupInput = {
	branch_name: 'test-branch',
	issue_number: '42',
	notify_config: undefined,
	coderabbit_ignore_reason: undefined,
	ai_review_ignore_reason: undefined,
	is_skip_watch: true,
	should_merge: false,
}

describe('git_pr_followup.run — --merge flag', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue('owner/repo')
		vi.mocked(git_gh_command.issue_get_title).mockResolvedValue('Test issue')
		vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(PR_URL)
		vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
			rollup: [],
			merge_state_status: undefined,
			review_decision: undefined,
		})
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue('[]')
		vi.mocked(git_pr_ai_review.handle_ai_review_findings).mockResolvedValue()
		vi.mocked(telegram_notify.send).mockResolvedValue()
		vi.mocked(git_gh_command.pr_merge).mockResolvedValue()
	})

	it('calls notify before pr_merge when should_merge is true', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		const [notify_order] = vi.mocked(telegram_notify.send).mock.invocationCallOrder
		const [merge_order] = vi.mocked(git_gh_command.pr_merge).mock.invocationCallOrder

		expect(notify_order).toBeLessThan(merge_order ?? Number.POSITIVE_INFINITY)
	})

	it('calls pr_merge with the branch name when should_merge is true', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		expect(vi.mocked(git_gh_command.pr_merge)).toHaveBeenCalledWith(BASE_INPUT.branch_name)
	})

	it('does not call pr_merge when should_merge is false', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(vi.mocked(git_gh_command.pr_merge)).not.toHaveBeenCalled()
	})
})
