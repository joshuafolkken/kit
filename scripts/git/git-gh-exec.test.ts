import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check_gh_installed, GH_NOT_INSTALLED_MSG } from './git-gh-check'
import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec, has_stderr_field } from './git-gh-exec'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const mocked_check = vi.mocked(check_gh_installed)
const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

// execa's resolved Result is a large interface; these helpers only need
// `stdout`, so a minimal stub is bridged through `unknown`.
function fake_stdout_result(stdout: string): ExecaResult {
	const result = { stdout }

	return result as unknown as ExecaResult
}

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

		await expect(git_gh_exec.exec_gh_command(['version'])).rejects.toThrow(GH_NOT_INSTALLED_MSG)
	})
})

const PR_VIEW_ARGS = ['pr', 'view']

describe('exec_gh_command — output handling', () => {
	it('returns trimmed stdout on success', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result('pr-url\n'))

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).resolves.toBe('pr-url')
	})

	it('throws with the stderr text when gh fails', async () => {
		const stderr_text = 'no such pr'

		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error('failed'), { stderr: `${stderr_text}\n` }),
		)

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow(stderr_text)
	})
})

describe('exec_gh_command_with_stdin', () => {
	it('passes stdin_body to execa and returns trimmed stdout', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result('done\n'))

		const result = await git_gh_exec.exec_gh_command_with_stdin({
			args: ['pr', 'create', BODY_FILE_FLAG, BODY_FROM_STDIN],
			stdin_body: 'body text',
		})

		expect(result).toBe('done')
		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), { input: 'body text' })
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
