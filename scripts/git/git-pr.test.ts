import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./animation-helpers', () => ({
	animation_helpers: {
		execute_with_animation: vi.fn(),
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
		display_pr_opened_message: vi.fn(),
		display_pr_url: vi.fn(),
		display_pr_exists_message: vi.fn(),
		display_merged_pr_message: vi.fn(),
	},
}))

const { git_pr } = await import('./git-pr')
const { git_gh_command } = await import('./git-gh-command')
const { git_pr_messages } = await import('./git-pr-messages')
const { git_pr_error } = await import('./git-pr-error')
const { animation_helpers } = await import('./animation-helpers')

const BRANCH = 'test-branch'
const PR_TITLE = 'Test title'
const PR_BODY = 'Test body'
const FAKE_ISSUE_COMMIT = 'My feature #42'
const FAKE_PR_URL = 'https://github.com/owner/repo/pull/1'
const CREATED_PR_URL = 'https://github.com/owner/repo/pull/2'
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
	vi.mocked(git_gh_command.pr_create).mockResolvedValue(CREATED_PR_URL)
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue(FAKE_PR_URL)
})

describe('git_pr.create_with_issue_info — build_body behavior', () => {
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

// joshuafolkken/kit#1232. The command used to sleep five seconds and then watch the rollup on a
// two-minute budget, and `pnpm josh followup` started the same wait over the moment it returned.
// These assertions pin that the wait is gone from every path, not only the freshly-created one.
describe('git_pr.create — returns as soon as the pull request is open', () => {
	it('does not watch the checks after creating the PR', async () => {
		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
	})

	it('does not watch the checks when a PR is already open on the branch', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'OPEN' }))

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
		expect(vi.mocked(git_gh_command.pr_create)).not.toHaveBeenCalled()
		expect(vi.mocked(git_pr_messages.display_pr_opened_message)).toHaveBeenCalledOnce()
	})

	it('does not watch the checks when the branch PR is already merged', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'MERGED' }))

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
		expect(vi.mocked(git_gh_command.pr_create)).toHaveBeenCalledWith(PR_TITLE, PR_BODY)
	})

	it('does not watch the checks when the PR state cannot be read', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue('')

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
		expect(vi.mocked(git_pr_messages.display_pr_opened_message)).toHaveBeenCalledOnce()
	})
})

// The five-second sleep that is gone was also what let the `?head=…` listing catch up, and that
// listing is eventually consistent — so where the reported URL comes from is now load-bearing
// (joshuafolkken/kit#1232).
describe('git_pr.create — where the reported URL comes from', () => {
	it('reports the URL the create call answered with, without re-reading it', async () => {
		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_pr_messages.display_pr_url)).toHaveBeenCalledWith(CREATED_PR_URL)
		expect(vi.mocked(git_gh_command.pr_get_url)).not.toHaveBeenCalled()
	})

	// Nothing was created on this path, so there is no answer to carry — the branch lookup is the
	// only source, and by then the pull request has existed long enough for the listing to hold it.
	it('falls back to the branch lookup when the PR already exists', async () => {
		vi.mocked(git_pr_error.is_pr_already_exists_error).mockReturnValueOnce(true)
		vi.mocked(git_gh_command.pr_create).mockRejectedValueOnce(new Error('already exists'))

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH)

		expect(vi.mocked(git_pr_messages.display_pr_exists_message)).toHaveBeenCalledOnce()
		expect(vi.mocked(git_pr_messages.display_pr_url)).toHaveBeenCalledWith(FAKE_PR_URL)
	})
})
