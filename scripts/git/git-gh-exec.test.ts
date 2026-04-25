import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check_gh_installed, GH_NOT_INSTALLED_MSG } from './git-gh-check'
import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec, has_stderr_field } from './git-gh-exec'

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const mocked_check = vi.mocked(check_gh_installed)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('git_gh_exec', () => {
	it('exposes exec_gh_command as a callable function', () => {
		expect(typeof git_gh_exec.exec_gh_command).toBe('function')
	})

	it('exposes exec_gh_command_with_stdin as a callable function', () => {
		expect(typeof git_gh_exec.exec_gh_command_with_stdin).toBe('function')
	})
})

describe('BODY_FILE_FLAG', () => {
	it('is the --body-file flag string', () => {
		expect(BODY_FILE_FLAG).toBe('--body-file')
	})
})

describe('BODY_FROM_STDIN', () => {
	it('is the stdin marker string', () => {
		expect(BODY_FROM_STDIN).toBe('-')
	})
})

describe('exec_gh_command — gh check integration', () => {
	it('propagates gh-not-installed error from check_gh_installed', async () => {
		mocked_check.mockRejectedValueOnce(new Error(GH_NOT_INSTALLED_MSG))

		await expect(git_gh_exec.exec_gh_command('version')).rejects.toThrow(GH_NOT_INSTALLED_MSG)
	})
})

describe('has_stderr_field', () => {
	it('returns true for an Error with a string stderr property', () => {
		const error = Object.assign(new Error('fail'), { stderr: 'stderr output' })

		expect(has_stderr_field(error)).toBe(true)
	})

	it('returns false for a plain Error without stderr', () => {
		expect(has_stderr_field(new Error('fail'))).toBe(false)
	})

	it('returns false for a non-Error object', () => {
		expect(has_stderr_field({ stderr: 'output' })).toBe(false)
	})

	it('returns false for an Error with a non-string stderr', () => {
		const error = Object.assign(new Error('fail'), { stderr: 42 })

		expect(has_stderr_field(error)).toBe(false)
	})
})
