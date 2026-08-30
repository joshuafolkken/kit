import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo_get_name_with_owner_mock = vi.hoisted(() => vi.fn())
const issue_get_title_mock = vi.hoisted(() => vi.fn())

vi.mock('node:util', () => ({ parseArgs: vi.fn().mockReturnValue({ values: {} }) }))
vi.mock('../scripts/git/git-gh-repo', () => ({
	git_gh_repo: { repo_get_name_with_owner: repo_get_name_with_owner_mock },
}))
vi.mock('../scripts/git/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_get_title: issue_get_title_mock },
}))
vi.mock('../scripts/git/telegram-notify', () => ({
	telegram_notify: { send: vi.fn() },
}))
vi.mock('./environment-loader', () => ({ load_optional_environment: vi.fn() }))

const REPO_NAME_WITH_OWNER = 'owner/my-repo'
const ISSUE_TITLE = 'Fix login bug'
const OTHER_REPO_ISSUE_URL = 'https://github.com/joshuafolkken/joshuafolkken-com/issues/431'
const OTHER_REPO = 'joshuafolkken-com'
const OTHER_REPO_NAME_WITH_OWNER = `joshuafolkken/${OTHER_REPO}`
const OTHER_REPO_ISSUE_NUMBER = '431'
const OTHER_REPO_TARGET = {
	owner: 'joshuafolkken',
	repo: OTHER_REPO,
	name_with_owner: OTHER_REPO_NAME_WITH_OWNER,
	base_url: `https://github.com/${OTHER_REPO_NAME_WITH_OWNER}`,
	issue_number: OTHER_REPO_ISSUE_NUMBER,
}
const OTHER_REPO_PULL_URL = 'https://github.com/joshuafolkken/joshuafolkken-com/pull/12'
const KIT_ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/903'
const NON_GITHUB_URL = 'https://example.com/x'
const WORKING_DIRECTORY_REPO = 'my-repo'

const { telegram_test } = await import('./telegram-test')

beforeEach(() => {
	repo_get_name_with_owner_mock.mockReset()
	issue_get_title_mock.mockReset()
})

describe('telegram_test.fetch_repo_name — the working directory lookup', () => {
	it('returns only the repo name part after the slash', async () => {
		repo_get_name_with_owner_mock.mockResolvedValue(REPO_NAME_WITH_OWNER)

		expect(await telegram_test.fetch_repo_name()).toBe('my-repo')
	})

	it('returns undefined when the repository could not be read', async () => {
		repo_get_name_with_owner_mock.mockResolvedValue(undefined)

		expect(await telegram_test.fetch_repo_name()).toBeUndefined()
	})

	// joshuafolkken/kit#1063: this was a `gh repo view` spawn, which goes through GraphQL and is
	// answered 403 in a cloud session — so the notification header lost its repository name there.
	it('reads the name through the REST repository reader', async () => {
		repo_get_name_with_owner_mock.mockResolvedValue(REPO_NAME_WITH_OWNER)

		await telegram_test.fetch_repo_name()

		expect(repo_get_name_with_owner_mock).toHaveBeenCalledWith()
	})
})

describe('telegram_test.fetch_issue_title', () => {
	it('returns undefined without reading anything when there is no target', async () => {
		expect(await telegram_test.fetch_issue_title(undefined)).toBeUndefined()
		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})

	it('reads the title from the repository the target names', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		const result = await telegram_test.fetch_issue_title(OTHER_REPO_TARGET)

		expect(result).toBe(ISSUE_TITLE)
		expect(issue_get_title_mock).toHaveBeenCalledWith(
			OTHER_REPO_ISSUE_NUMBER,
			OTHER_REPO_NAME_WITH_OWNER,
		)
	})

	it('warns when the issue could not be read', async () => {
		issue_get_title_mock.mockResolvedValue(undefined)
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		const result = await telegram_test.fetch_issue_title(OTHER_REPO_TARGET)

		expect(result).toBeUndefined()
		expect(warn_spy).toHaveBeenCalledWith(
			expect.stringContaining(`${OTHER_REPO_NAME_WITH_OWNER}#${OTHER_REPO_ISSUE_NUMBER}`),
		)
		warn_spy.mockRestore()
	})
})

describe('telegram_test.resolve_context — the issue URL names the repository', () => {
	it('resolves the repository from the URL, not the working directory', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		const result = await telegram_test.resolve_context({ 'issue-url': OTHER_REPO_ISSUE_URL })

		expect(result).toStrictEqual({ repo_name: OTHER_REPO, issue_title: ISSUE_TITLE })
	})

	it('never asks the working directory which repository it is in', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		await telegram_test.resolve_context({ 'issue-url': OTHER_REPO_ISSUE_URL })

		expect(repo_get_name_with_owner_mock).not.toHaveBeenCalled()
		expect(issue_get_title_mock).toHaveBeenCalledWith(
			OTHER_REPO_ISSUE_NUMBER,
			OTHER_REPO_NAME_WITH_OWNER,
		)
	})
})

describe('telegram_test.resolve_context — an explicit title answers already', () => {
	it('reads no issue when --issue-title was given', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		const result = await telegram_test.resolve_context({
			'issue-url': OTHER_REPO_ISSUE_URL,
			'issue-title': 'Given on the command line',
		})

		expect(result.issue_title).toBeUndefined()
		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})

	it('still reads one when the flag is empty', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		const result = await telegram_test.resolve_context({
			'issue-url': OTHER_REPO_ISSUE_URL,
			'issue-title': '',
		})

		expect(result.issue_title).toBe(ISSUE_TITLE)
	})
})

describe('telegram_test.resolve_context — no issue URL to read', () => {
	it('falls back to the working directory repository', async () => {
		repo_get_name_with_owner_mock.mockResolvedValue(REPO_NAME_WITH_OWNER)

		const result = await telegram_test.resolve_context({})

		expect(result).toStrictEqual({ repo_name: WORKING_DIRECTORY_REPO, issue_title: undefined })
		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})

	it('falls back for a URL that is not a GitHub issue URL', async () => {
		repo_get_name_with_owner_mock.mockResolvedValue(REPO_NAME_WITH_OWNER)

		const result = await telegram_test.resolve_context({ 'issue-url': NON_GITHUB_URL })

		expect(result.repo_name).toBe(WORKING_DIRECTORY_REPO)
	})
})

// joshuafolkken/kit#994: `--pr-url` was not read, so a completion notification carrying only a PR
// link went out under the working directory's repository while its link pointed elsewhere — the
// same mismatch joshuafolkken/kit#903 fixed for `--issue-url`.
describe('telegram_test.resolve_context — the pull URL names the repository', () => {
	it('resolves the repository from the pull URL when there is no issue URL', async () => {
		const result = await telegram_test.resolve_context({ 'pr-url': OTHER_REPO_PULL_URL })

		expect(result.repo_name).toBe(OTHER_REPO)
	})

	it('never asks the working directory when a pull URL was given', async () => {
		await telegram_test.resolve_context({ 'pr-url': OTHER_REPO_PULL_URL })

		expect(repo_get_name_with_owner_mock).not.toHaveBeenCalled()
	})

	// A pull URL names no issue, so there is no title to read from it — the title stays the
	// `--issue-title` flag's job, and no `gh` call is spent guessing.
	it('reads no issue title from a pull URL', async () => {
		const result = await telegram_test.resolve_context({ 'pr-url': OTHER_REPO_PULL_URL })

		expect(result.issue_title).toBeUndefined()
		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})

	it('falls back to the working directory for a URL that is not a pull URL', async () => {
		repo_get_name_with_owner_mock.mockResolvedValue(REPO_NAME_WITH_OWNER)

		const result = await telegram_test.resolve_context({ 'pr-url': NON_GITHUB_URL })

		expect(result.repo_name).toBe(WORKING_DIRECTORY_REPO)
	})
})

// The order is what the Issue asked to be pinned: the issue URL identifies the issue whose title is
// also read, so it outranks a pull URL that can only answer the repository half.
describe('telegram_test.resolve_context — the issue URL outranks the pull URL', () => {
	it('prefers the issue URL when both are given', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		const result = await telegram_test.resolve_context({
			'issue-url': KIT_ISSUE_URL,
			'pr-url': OTHER_REPO_PULL_URL,
		})

		expect(result.repo_name).toBe('kit')
	})

	it('still reads the title from the issue URL when both are given', async () => {
		issue_get_title_mock.mockResolvedValue(ISSUE_TITLE)

		await telegram_test.resolve_context({
			'issue-url': KIT_ISSUE_URL,
			'pr-url': OTHER_REPO_PULL_URL,
		})

		expect(issue_get_title_mock).toHaveBeenCalledWith('903', 'joshuafolkken/kit')
	})
})
