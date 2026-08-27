import { beforeEach, describe, expect, it, vi } from 'vitest'

const exec_file_mock = vi.hoisted(() => vi.fn())
const issue_get_title_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile: exec_file_mock }))
vi.mock('node:util', () => ({
	promisify: (function_: unknown) => function_,
	parseArgs: vi.fn().mockReturnValue({ values: {} }),
}))
vi.mock('../scripts/git/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_get_title: issue_get_title_mock },
}))
vi.mock('../scripts/git/telegram-notify', () => ({
	telegram_notify: { send: vi.fn() },
}))
vi.mock('./environment-loader', () => ({ load_optional_environment: vi.fn() }))

const REPO_RESPONSE = { stdout: 'owner/my-repo\n', stderr: '' }
const ISSUE_TITLE = 'Fix login bug'
const OTHER_REPO_ISSUE_URL = 'https://github.com/joshuafolkken/joshuafolkken-com/issues/431'
const OTHER_REPO = 'joshuafolkken-com'
const OTHER_REPO_NAME_WITH_OWNER = `joshuafolkken/${OTHER_REPO}`
const OTHER_REPO_ISSUE_NUMBER = '431'
const OTHER_REPO_TARGET = {
	owner: 'joshuafolkken',
	repo: OTHER_REPO,
	name_with_owner: OTHER_REPO_NAME_WITH_OWNER,
	issue_number: OTHER_REPO_ISSUE_NUMBER,
}

const { telegram_test } = await import('./telegram-test')

beforeEach(() => {
	exec_file_mock.mockReset()
	issue_get_title_mock.mockReset()
})

describe('telegram_test.fetch_repo_name — the working directory lookup', () => {
	it('returns only the repo name part after the slash', async () => {
		exec_file_mock.mockResolvedValue(REPO_RESPONSE)

		expect(await telegram_test.fetch_repo_name()).toBe('my-repo')
	})

	it('returns undefined when gh command throws', async () => {
		exec_file_mock.mockRejectedValue(new Error('not found'))

		expect(await telegram_test.fetch_repo_name()).toBeUndefined()
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

		expect(exec_file_mock).not.toHaveBeenCalled()
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
		exec_file_mock.mockResolvedValue(REPO_RESPONSE)

		const result = await telegram_test.resolve_context({})

		expect(result).toStrictEqual({ repo_name: 'my-repo', issue_title: undefined })
		expect(issue_get_title_mock).not.toHaveBeenCalled()
	})

	it('falls back for a URL that is not a GitHub issue URL', async () => {
		exec_file_mock.mockResolvedValue(REPO_RESPONSE)

		const result = await telegram_test.resolve_context({ 'issue-url': 'https://example.com/x' })

		expect(result.repo_name).toBe('my-repo')
	})
})
