import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/lib/animation-helpers', () => ({
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
		pr_get_classification: vi.fn(),
		pr_ensure_classification: vi.fn(),
		pr_update_body: vi.fn(),
		issue_view_json: vi.fn(),
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
const { animation_helpers } = await import('#scripts/lib/animation-helpers')

const BRANCH = 'test-branch'
const PR_TITLE = 'Test title'
const PR_BODY = 'Test body'
const FAKE_ISSUE_COMMIT = 'My feature #42'
const FAKE_PR_URL = 'https://github.com/owner/repo/pull/1'
const CREATED_PR_URL = 'https://github.com/owner/repo/pull/2'
const EXTRA_BODY = 'Some description'
const ISSUE_CLOSING = 'closes #42'
const FULL_BODY = `${ISSUE_CLOSING}\n\n${EXTRA_BODY}`
const BUGFIX = 'bugfix'
const ENHANCEMENT = 'enhancement'
const BREAKING = 'breaking-change'
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
	vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(
		JSON.stringify({ labels: [{ name: 'bug' }], body: '' }),
	)
})

describe('git_pr.create_with_issue_info — build_body behavior', () => {
	it('does not open a pull request when the issue has no classification', async () => {
		vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(
			JSON.stringify({ labels: [], body: '' }),
		)

		await expect(git_pr.create_with_issue_info(FAKE_ISSUE_INFO)).rejects.toThrow(
			'Choose one release classification',
		)
		expect(git_gh_command.pr_create).not.toHaveBeenCalled()
	})

	it('does not open a pull request when the issue cannot be read', async () => {
		vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(undefined)

		await expect(git_pr.create_with_issue_info(FAKE_ISSUE_INFO)).rejects.toThrow(
			'Could not read issue',
		)
		expect(git_gh_command.pr_create).not.toHaveBeenCalled()
	})
	it('passes only closes #N when no extra_body supplied', async () => {
		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO)

		expect(vi.mocked(git_gh_command.pr_create)).toHaveBeenCalledWith(
			FAKE_ISSUE_COMMIT,
			ISSUE_CLOSING,
			BUGFIX,
		)
	})

	it('prepends closes #N to extra_body when extra_body is supplied', async () => {
		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO, EXTRA_BODY)

		expect(vi.mocked(git_gh_command.pr_create)).toHaveBeenCalledWith(
			FAKE_ISSUE_COMMIT,
			FULL_BODY,
			BUGFIX,
		)
	})
})

it('opens one breaking-change PR for an enhancement that breaks compatibility', async () => {
	vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(
		JSON.stringify({ labels: [{ name: ENHANCEMENT }, { name: BREAKING }], body: '' }),
	)

	await git_pr.create_with_issue_info(FAKE_ISSUE_INFO)

	expect(git_gh_command.pr_create).toHaveBeenCalledWith(FAKE_ISSUE_COMMIT, ISSUE_CLOSING, BREAKING)
})

// joshuafolkken/kit#2446: a rerun carrying the live-execution evidence must reach the pull request the
// first run already opened, or the merge `followup` refused for lacking it can never be recovered.
describe('git_pr.create_with_issue_info — a pull request that is already open', () => {
	beforeEach(() => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'OPEN' }))
		vi.mocked(git_gh_command.pr_get_classification).mockResolvedValue(BUGFIX)
	})

	it('writes a supplied body onto the open pull request', async () => {
		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO, EXTRA_BODY)

		expect(vi.mocked(git_gh_command.pr_update_body)).toHaveBeenCalledWith(BRANCH, FULL_BODY)
		expect(vi.mocked(git_gh_command.pr_create)).not.toHaveBeenCalled()
	})

	it('leaves the open pull request body alone when no body is supplied', async () => {
		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO)

		expect(vi.mocked(git_gh_command.pr_update_body)).not.toHaveBeenCalled()
	})

	it('repairs a missing classification on a rerun', async () => {
		vi.mocked(git_gh_command.pr_get_classification).mockResolvedValue(undefined)

		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO)

		expect(git_gh_command.pr_ensure_classification).toHaveBeenCalledWith(BRANCH, BUGFIX)
	})

	it('updates an already classified pull request without an issue declaration', async () => {
		vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(
			JSON.stringify({ labels: [], body: '' }),
		)

		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO, EXTRA_BODY)

		expect(git_gh_command.issue_view_json).not.toHaveBeenCalled()
		expect(git_gh_command.pr_update_body).toHaveBeenCalledWith(BRANCH, FULL_BODY)
	})
})

describe('git_pr.create_with_issue_info — a merged pull request', () => {
	it('uses the current issue classification after the previous pull request merged', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'MERGED' }))
		vi.mocked(git_gh_command.issue_view_json).mockResolvedValue(
			JSON.stringify({ labels: [], body: `- リリース分類: ${ENHANCEMENT}` }),
		)

		await git_pr.create_with_issue_info(FAKE_ISSUE_INFO)

		expect(git_gh_command.pr_get_classification).not.toHaveBeenCalled()
		expect(git_gh_command.pr_create).toHaveBeenCalledWith(
			FAKE_ISSUE_COMMIT,
			ISSUE_CLOSING,
			ENHANCEMENT,
		)
	})
})

// joshuafolkken/kit#1232. The command used to sleep five seconds and then watch the rollup on a
// two-minute budget, and `pnpm josh followup` started the same wait over the moment it returned.
// These assertions pin that the wait is gone from every path, not only the freshly-created one.
describe('git_pr.create — returns as soon as the pull request is open', () => {
	it('does not watch the checks after creating the PR', async () => {
		await git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX })

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
	})

	it('does not watch the checks when a PR is already open on the branch', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'OPEN' }))

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX })

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
		expect(vi.mocked(git_gh_command.pr_create)).not.toHaveBeenCalled()
		expect(vi.mocked(git_pr_messages.display_pr_opened_message)).toHaveBeenCalledOnce()
	})

	it('does not watch the checks when the branch PR is already merged', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'MERGED' }))

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX })

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
		expect(vi.mocked(git_gh_command.pr_create)).toHaveBeenCalledWith(PR_TITLE, PR_BODY, BUGFIX)
	})

	it('does not watch the checks when the PR state cannot be read', async () => {
		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockResolvedValue('')

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX })

		expect(vi.mocked(git_gh_command.pr_checks_watch)).not.toHaveBeenCalled()
		expect(vi.mocked(git_pr_messages.display_pr_opened_message)).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3263: an unreadable state used to answer "not merged", so a rate limit wrote the
// new body onto a pull request that had already merged.
describe('git_pr.create — a pull request whose state cannot be read', () => {
	it('stops without writing when the PR state read fails', async () => {
		const failure = new Error('gh api could not read the pull requests for branch')

		vi.mocked(git_gh_command.pr_exists).mockResolvedValue(true)
		vi.mocked(git_gh_command.pr_view).mockRejectedValue(failure)

		await expect(
			git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX, should_replace_body: true }),
		).rejects.toBe(failure)
		expect(vi.mocked(git_gh_command.pr_update_body)).not.toHaveBeenCalled()
		expect(vi.mocked(git_gh_command.pr_create)).not.toHaveBeenCalled()
	})
})

// The five-second sleep that is gone was also what let the `?head=…` listing catch up, and that
// listing is eventually consistent — so where the reported URL comes from is now load-bearing
// (joshuafolkken/kit#1232).
describe('git_pr.create — where the reported URL comes from', () => {
	it('reports the URL the create call answered with, without re-reading it', async () => {
		await git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX })

		expect(vi.mocked(git_pr_messages.display_pr_url)).toHaveBeenCalledWith(CREATED_PR_URL)
		expect(vi.mocked(git_gh_command.pr_get_url)).not.toHaveBeenCalled()
	})

	// Nothing was created on this path, so there is no answer to carry — the branch lookup is the
	// only source, and by then the pull request has existed long enough for the listing to hold it.
	it('falls back to the branch lookup when the PR already exists', async () => {
		vi.mocked(git_pr_error.is_pr_already_exists_error).mockReturnValueOnce(true)
		vi.mocked(git_gh_command.pr_create).mockRejectedValueOnce(new Error('already exists'))

		await git_pr.create(PR_TITLE, PR_BODY, BRANCH, { label: BUGFIX })

		expect(vi.mocked(git_pr_messages.display_pr_exists_message)).toHaveBeenCalledOnce()
		expect(vi.mocked(git_pr_messages.display_pr_url)).toHaveBeenCalledWith(FAKE_PR_URL)
	})
})
