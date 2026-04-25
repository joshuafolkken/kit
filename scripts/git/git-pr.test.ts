import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./animation-helpers', () => ({
	animation_helpers: {
		execute_with_animation: vi.fn(),
	},
}))

vi.mock('./git-conflict', () => ({
	git_conflict: {
		check_pr_status_for_errors: vi.fn(),
	},
}))

vi.mock('./git-countdown', () => ({
	git_countdown: {
		wait_for_seconds: vi.fn(),
	},
}))

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		pr_exists: vi.fn(),
		pr_create: vi.fn(),
		pr_checks_watch: vi.fn(),
		pr_get_url: vi.fn(),
		pr_view: vi.fn(),
	},
}))

vi.mock('./git-pr-error', () => ({
	git_pr_error: {
		is_pr_already_exists_error: vi.fn().mockReturnValue(false),
	},
}))

vi.mock('./git-pr-messages', () => ({
	git_pr_messages: {
		display_success_message: vi.fn(),
		display_error_message: vi.fn(),
		display_pr_url: vi.fn(),
		display_pr_exists_message: vi.fn(),
		display_merged_pr_message: vi.fn(),
	},
}))

const { git_pr } = await import('./git-pr')
const { git_gh_command } = await import('./git-gh-command')
const { git_conflict } = await import('./git-conflict')
const { animation_helpers } = await import('./animation-helpers')
const { git_countdown } = await import('./git-countdown')

const BRANCH = 'test-branch'
const PR_TITLE = 'Test title'
const PR_BODY = 'Test body'
const FAKE_ISSUE_COMMIT = 'My feature #42'
const FAKE_PR_URL = 'https://github.com/owner/repo/pull/1'
const FAKE_ISSUE_INFO = {
	title: 'My feature',
	number: '42',
	branch_name: BRANCH,
	commit_message: FAKE_ISSUE_COMMIT,
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(git_gh_command.pr_exists).mockResolvedValue(false)
	vi.mocked(animation_helpers.execute_with_animation).mockImplementation(
		async (_label: string, action: () => Promise<unknown>) => await action(),
	)
	vi.mocked(git_gh_command.pr_create).mockResolvedValue('')
	vi.mocked(git_countdown.wait_for_seconds).mockResolvedValue()
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(FAKE_PR_URL)
})

describe('git_pr.create_with_issue_info — build_body behavior', () => {
	beforeEach(() => {
		vi.mocked(git_gh_command.pr_checks_watch).mockResolvedValue({ timed_out: true })
	})

	it('passes only closes #N when no extra_body supplied', async () => {
		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO)

		expect(vi.mocked(git_gh_command.pr_create)).toHaveBeenCalledWith(
			FAKE_ISSUE_COMMIT,
			'closes #42',
		)
	})

	it('prepends closes #N to extra_body when extra_body is supplied', async () => {
		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO, 'Some description')

		expect(vi.mocked(git_gh_command.pr_create)).toHaveBeenCalledWith(
			FAKE_ISSUE_COMMIT,
			'closes #42\n\nSome description',
		)
	})
})

describe('git_pr.create — post-watch conflict check behavior', () => {
	it('skips conflict check when watch times out', async () => {
		vi.mocked(git_gh_command.pr_checks_watch).mockResolvedValue({ timed_out: true })

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_conflict.check_pr_status_for_errors)).not.toHaveBeenCalled()
	})

	it('calls conflict check when watch completes without timeout', async () => {
		vi.mocked(git_gh_command.pr_checks_watch).mockResolvedValue({ timed_out: false })
		vi.mocked(git_conflict.check_pr_status_for_errors).mockResolvedValue()

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_conflict.check_pr_status_for_errors)).toHaveBeenCalledWith(BRANCH)
	})
})
