import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check_gh_installed, GH_NOT_INSTALLED_MSG } from './git-gh-check'
import {
	BODY_FILE_FLAG,
	BODY_FROM_STDIN,
	git_gh_exec,
	has_stderr_field,
	has_stdout_field,
} from './git-gh-exec'

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
const NON_ERROR_CASE = 'returns false for a non-Error object'

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

	it(NON_ERROR_CASE, () => {
		expect(has_stderr_field({ stderr: 'output' })).toBe(false)
	})

	it('returns false for an Error with a non-string stderr', () => {
		const error = Object.assign(new Error('fail'), { stderr: 42 })

		expect(has_stderr_field(error)).toBe(false)
	})
})

// joshuafolkken/kit#957: `epic:bundle` has to tell a number that resolves to nothing (404) from a
// read that failed (403, 429, a dropped connection). `gh issue view` goes through GraphQL and
// reports a failure as prose, so the status comes from a REST probe — and it is read from the
// status line `--include` prints, never from `gh`'s wording, which is prose that can be reworded.
const NOT_FOUND_LINE = 'HTTP/2.0 404 Not Found\nAccess-Control-Allow-Origin: *\n'
const OK_LINE = 'HTTP/2.0 200 OK\nServer: github.com\n'
const ISSUE_PATH = 'repos/o/r/issues/1'
const NOT_FOUND_STATUS = 404
const OK_STATUS = 200
const RATE_LIMITED_STATUS = 429

describe('parse_status_line', () => {
	it('reads the status code from the line gh api --include prints', () => {
		expect(git_gh_exec.parse_status_line(NOT_FOUND_LINE)).toBe(NOT_FOUND_STATUS)
	})

	it('reads a success status the same way', () => {
		expect(git_gh_exec.parse_status_line(OK_LINE)).toBe(OK_STATUS)
	})

	it('reads a rate-limit status the same way', () => {
		expect(git_gh_exec.parse_status_line('HTTP/1.1 429 Too Many Requests\n')).toBe(
			RATE_LIMITED_STATUS,
		)
	})

	// No status line means no status was reached — a caller reading this as "not 404" treats it as a
	// failed read, which is what a dropped connection is.
	it('answers undefined when the output carries no status line', () => {
		expect(git_gh_exec.parse_status_line('')).toBeUndefined()
	})

	// The line has to be the first thing in the output. A body quoting one would otherwise be read as
	// the response's own status.
	it('does not read a status line quoted later in the output', () => {
		expect(git_gh_exec.parse_status_line('{"message":"HTTP/2.0 404 Not Found"}')).toBeUndefined()
	})
})

describe('exec_gh_api_status', () => {
	it('returns the status of a request that succeeded', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(OK_LINE))

		await expect(git_gh_exec.exec_gh_api_status(ISSUE_PATH)).resolves.toBe(OK_STATUS)
	})

	// gh exits non-zero on a 404, so the status line arrives on the thrown error rather than on a
	// resolved result. Losing it there is what left the two failures indistinguishable.
	it('returns the status when gh exits non-zero', async () => {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error('failed'), { stdout: NOT_FOUND_LINE, stderr: 'gh: Not Found' }),
		)

		await expect(git_gh_exec.exec_gh_api_status('repos/o/r/issues/99999')).resolves.toBe(
			NOT_FOUND_STATUS,
		)
	})

	it('returns undefined when the failure carried no output at all', async () => {
		mocked_execa.mockRejectedValueOnce(new Error('connection reset'))

		await expect(git_gh_exec.exec_gh_api_status(ISSUE_PATH)).resolves.toBeUndefined()
	})
})

describe('exec_gh_api_status — what it asks gh for', () => {
	it('asks gh for the headers without the response body', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(OK_LINE))

		await git_gh_exec.exec_gh_api_status(ISSUE_PATH)

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', '--include', '--silent', ISSUE_PATH])
	})

	it('returns undefined rather than throwing when gh is not installed', async () => {
		mocked_check.mockRejectedValueOnce(new Error(GH_NOT_INSTALLED_MSG))

		await expect(git_gh_exec.exec_gh_api_status(ISSUE_PATH)).resolves.toBeUndefined()
	})
})

describe('has_stdout_field', () => {
	it('returns true for an Error with a string stdout property', () => {
		const error = Object.assign(new Error('fail'), { stdout: 'out' })

		expect(has_stdout_field(error)).toBe(true)
	})

	it('returns false for a plain Error without stdout', () => {
		expect(has_stdout_field(new Error('fail'))).toBe(false)
	})

	it(NON_ERROR_CASE, () => {
		expect(has_stdout_field({ stdout: 'out' })).toBe(false)
	})
})
