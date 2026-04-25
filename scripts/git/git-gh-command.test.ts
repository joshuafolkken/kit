import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_command, parse_pr_state_string } from './git-gh-command'
import { PR_CHECKS_WATCH_TIMEOUT_MS } from './git-pr-checks-watch'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
	},
	BODY_FILE_FLAG: '--body-file',
	BODY_FROM_STDIN: '-',
	has_stderr_field: vi.fn(),
}))

vi.mock('./git-pr-checks-watch', () => ({
	git_pr_checks_watch: {
		pr_checks_watch: vi.fn(),
	},
	PR_CHECKS_WATCH_TIMEOUT_MS: 120_000,
}))

vi.mock('./git-command', () => ({
	git_command: {
		get_default_branch: vi.fn(),
	},
}))

const { git_gh_exec } = await import('./git-gh-exec')
const mocked_exec = vi.mocked(git_gh_exec.exec_gh_command)
const { git_command } = await import('./git-command')
const mocked_get_default_branch = vi.mocked(git_command.get_default_branch)

const DEFAULT_BRANCH = 'main'
const FEATURE_BRANCH = 'feature-branch'
const NETWORK_ERROR = 'network error'
const PR_TITLE = 'title'
const PR_BODY = 'body'
const GITHUB_PR_URL = 'https://github.com/owner/repo/pull/1'
const TITLE_WITH_SPACES = 'title with spaces'
const BODY_WITH_SPECIAL = 'body with $special chars'

beforeEach(() => {
	vi.clearAllMocks()
	mocked_get_default_branch.mockResolvedValue(DEFAULT_BRANCH)
})

describe('git_gh_command', () => {
	it('exposes pr_merge as a callable function', () => {
		expect(typeof git_gh_command.pr_merge).toBe('function')
	})
})

describe('PR_CHECKS_WATCH_TIMEOUT_MS', () => {
	const MIN_TIMEOUT_MS = 60_000
	const MAX_TIMEOUT_MS = 300_000

	it('is defined and within a reasonable range', () => {
		expect(PR_CHECKS_WATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS)
		expect(PR_CHECKS_WATCH_TIMEOUT_MS).toBeLessThanOrEqual(MAX_TIMEOUT_MS)
	})
})

describe('parse_pr_state_string', () => {
	it('returns trimmed string for a valid value', () => {
		expect(parse_pr_state_string('  hello  ')).toBe('hello')
	})

	it('returns unquoted value as-is', () => {
		expect(parse_pr_state_string('OPEN')).toBe('OPEN')
	})

	it('strips quotes and trims surrounding whitespace', () => {
		expect(parse_pr_state_string('  "main"  ')).toBe('main')
	})

	it('returns undefined for empty string', () => {
		expect(parse_pr_state_string('')).toBeUndefined()
	})

	it('returns undefined for whitespace-only string', () => {
		expect(parse_pr_state_string('   ')).toBeUndefined()
	})

	it('strips surrounding double quotes', () => {
		expect(parse_pr_state_string('"hello"')).toBe('hello')
	})

	it('returns undefined when only quotes remain after stripping', () => {
		expect(parse_pr_state_string('""')).toBeUndefined()
	})
})

describe('git_gh_command.pr_exists', () => {
	it('returns true when exec_gh_command succeeds', async () => {
		mocked_exec.mockResolvedValue('some output')
		const is_found = await git_gh_command.pr_exists(FEATURE_BRANCH)

		expect(is_found).toBe(true)
	})

	it('returns false when exec_gh_command throws', async () => {
		mocked_exec.mockRejectedValue(new Error('not found'))
		const is_found = await git_gh_command.pr_exists(FEATURE_BRANCH)

		expect(is_found).toBe(false)
	})
})

describe('git_gh_command.pr_create — PR_ALREADY_EXISTS error handling', () => {
	it('throws PR_ALREADY_EXISTS when error message contains "already exists"', async () => {
		mocked_exec.mockRejectedValue(new Error('a pull request already exists for this branch'))

		await expect(git_gh_command.pr_create(PR_TITLE, PR_BODY)).rejects.toThrow('PR_ALREADY_EXISTS')
	})

	it('rethrows original error when error is unrelated to existing PR', async () => {
		mocked_exec.mockRejectedValue(new Error(NETWORK_ERROR))

		await expect(git_gh_command.pr_create(PR_TITLE, PR_BODY)).rejects.toThrow(NETWORK_ERROR)
	})
})

describe('git_gh_command.pr_create — base branch and label', () => {
	it('uses the value from get_default_branch for --base', async () => {
		mocked_get_default_branch.mockResolvedValue('develop')
		mocked_exec.mockResolvedValue(GITHUB_PR_URL)

		await git_gh_command.pr_create(PR_TITLE, PR_BODY)

		expect(mocked_exec).toHaveBeenCalledWith(expect.arrayContaining(['--base', 'develop']))
	})

	it('does not include --label in the pr create command', async () => {
		mocked_exec.mockResolvedValue(GITHUB_PR_URL)

		await git_gh_command.pr_create(PR_TITLE, PR_BODY)

		expect(mocked_exec).toHaveBeenCalledWith(expect.not.arrayContaining(['--label']))
	})

	it('passes title and body as separate array elements without shell escaping', async () => {
		mocked_exec.mockResolvedValue(GITHUB_PR_URL)

		await git_gh_command.pr_create(TITLE_WITH_SPACES, BODY_WITH_SPECIAL)

		expect(mocked_exec).toHaveBeenCalledWith(
			expect.arrayContaining(['--title', TITLE_WITH_SPACES, '--body', BODY_WITH_SPECIAL]),
		)
	})
})

describe('git_gh_command.pr_get_url', () => {
	it('returns parsed URL when exec succeeds', async () => {
		mocked_exec.mockResolvedValue(GITHUB_PR_URL)
		const url = await git_gh_command.pr_get_url(FEATURE_BRANCH)

		expect(url).toBe(GITHUB_PR_URL)
	})

	it('returns undefined when exec throws', async () => {
		mocked_exec.mockRejectedValue(new Error('no PR'))
		const url = await git_gh_command.pr_get_url(FEATURE_BRANCH)

		expect(url).toBeUndefined()
	})
})
