import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_command, parse_pr_state_string } from './git-gh-command'
import { PR_CHECKS_WATCH_TIMEOUT_MS } from './git-pr-checks-watch'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
		exec_gh_api: vi.fn(),
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
const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const { git_command } = await import('./git-command')
const mocked_get_default_branch = vi.mocked(git_command.get_default_branch)

const DEFAULT_BRANCH = 'main'
const NETWORK_ERROR = 'network error'
const PR_TITLE = 'title'
const PR_BODY = 'body'
const GITHUB_PR_URL = 'https://github.com/owner/repo/pull/1'
const TITLE_WITH_SPACES = 'title with spaces'
const BODY_WITH_SPECIAL = 'body with $special chars'
const PR_NUMBER = 578
const REPO_NAME = 'joshuafolkken/kit'

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

const FULLY_QUOTED = '"hello"'
const QUOTED_FIRST_WORD = '"queue" should stop at the first failure'
const QUOTED_LAST_WORD = 'the flag is called "--merge"'

describe('parse_pr_state_string', () => {
	it('returns trimmed string for a valid value', () => {
		expect(parse_pr_state_string('  hello  ')).toBe('hello')
	})

	it('returns unquoted value as-is', () => {
		expect(parse_pr_state_string('OPEN')).toBe('OPEN')
	})

	it('trims surrounding whitespace without touching the quotes inside it', () => {
		expect(parse_pr_state_string('  "main"  ')).toBe('"main"')
	})

	it('returns undefined for empty string', () => {
		expect(parse_pr_state_string('')).toBeUndefined()
	})

	it('returns undefined for whitespace-only string', () => {
		expect(parse_pr_state_string(' '.repeat(3))).toBeUndefined()
	})

	// joshuafolkken/kit#993: every caller asks with `--jq`, which unwraps the JSON string itself, so
	// a quote that arrives is data. Stripping it ate a real character from any answer carrying one.
	it('keeps surrounding double quotes, which are data rather than JSON wrapping', () => {
		expect(parse_pr_state_string(FULLY_QUOTED)).toBe(FULLY_QUOTED)
	})

	it('keeps a leading quote', () => {
		expect(parse_pr_state_string(QUOTED_FIRST_WORD)).toBe(QUOTED_FIRST_WORD)
	})

	it('keeps a trailing quote', () => {
		expect(parse_pr_state_string(QUOTED_LAST_WORD)).toBe(QUOTED_LAST_WORD)
	})

	// A pair of quotes is two real characters once nothing is stripped, so the answer is no longer
	// empty and no longer collapses to undefined.
	it('returns a bare quote pair rather than undefined', () => {
		expect(parse_pr_state_string('""')).toBe('""')
	})
})

describe('git_gh_command.pr_checkout', () => {
	it('checks out the PR branch by number', async () => {
		mocked_exec.mockResolvedValue('')
		await git_gh_command.pr_checkout(PR_NUMBER)

		expect(mocked_exec).toHaveBeenCalledWith(['pr', 'checkout', String(PR_NUMBER)])
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

// joshuafolkken/kit#993 removed the unquoting from the parser the repository-name read shares with
// the issue-title read. It never received a quoted answer, so it must be unchanged by the removal —
// which is what the Issue asked to be confirmed rather than assumed. The PR-url reader shares the
// same parser and is asserted in `git-gh-pr-read.test.ts`, where it now lives.
describe('the other callers of the shared parser are unaffected', () => {
	// joshuafolkken/kit#1023 moved this read to `gh api`; the parser it shares is unchanged.
	it('reads a repository name unchanged', async () => {
		mocked_api.mockResolvedValue(REPO_NAME)

		await expect(git_gh_command.repo_get_name_with_owner()).resolves.toBe(REPO_NAME)
	})

	it('still trims whitespace off a repository name', async () => {
		mocked_api.mockResolvedValue(`${REPO_NAME}\n`)

		await expect(git_gh_command.repo_get_name_with_owner()).resolves.toBe(REPO_NAME)
	})
})
