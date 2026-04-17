import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_followup, type FollowupInput } from './git-pr-followup'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		repo_get_name_with_owner: vi.fn(),
		issue_get_title: vi.fn(),
		pr_get_url: vi.fn(),
		pr_get_review_comments: vi.fn(),
		pr_get_comments: vi.fn(),
		pr_merge: vi.fn(),
		pr_comment: vi.fn(),
		issue_get_body: vi.fn(),
		issue_comment: vi.fn(),
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
