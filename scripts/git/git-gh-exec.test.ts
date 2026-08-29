import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check_gh_installed, GH_NOT_INSTALLED_MSG } from './git-gh-check'
import { BODY_FROM_STDIN, git_gh_exec, has_stderr_field, has_stdout_field } from './git-gh-exec'

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
const GH_FAILED = 'failed'
const NOT_FOUND_STDERR = 'gh: Not Found'
const THROWS_STDERR_CASE = 'throws with the stderr text when gh fails'

describe('exec_gh_command — output handling', () => {
	it('returns trimmed stdout on success', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result('pr-url\n'))

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).resolves.toBe('pr-url')
	})

	it(THROWS_STDERR_CASE, async () => {
		const stderr_text = 'no such pr'

		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), { stderr: `${stderr_text}\n` }),
		)

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow(stderr_text)
	})
})

// `gh api` splits a failed request across both streams: one summary line on stderr and the JSON
// error body on stdout. Dropping the body dropped the only place the reason is written — and
// `handle_pr_create_error` reads the reason (joshuafolkken/kit#1029).
describe('exec_gh_command — a failed gh api request', () => {
	const VALIDATION_SUMMARY = 'gh: Validation Failed (HTTP 422)'
	const DUPLICATE_BODY =
		'{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom",' +
		'"message":"A pull request already exists for joshuafolkken:tmp-1029-head."}]}'

	function reject_with_split_output(): void {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), {
				stderr: `${VALIDATION_SUMMARY}\n`,
				stdout: `${DUPLICATE_BODY}\n`,
			}),
		)
	}

	it('carries the JSON error body gh wrote to stdout', async () => {
		reject_with_split_output()

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow('already exists')
	})

	it('keeps the stderr summary ahead of the body', async () => {
		reject_with_split_output()

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow(
			`${VALIDATION_SUMMARY}\n${DUPLICATE_BODY}`,
		)
	})

	// A `gh <noun> <verb>` failure writes nothing to stdout, and its message must not grow a trailing
	// separator for an empty one.
	it('leaves a stderr-only failure exactly as it was', async () => {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), { stderr: `${NOT_FOUND_STDERR}\n`, stdout: '' }),
		)

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow(
			new Error(NOT_FOUND_STDERR),
		)
	})
})

describe('exec_gh_command_with_stdin', () => {
	it('passes stdin_body to execa and returns trimmed stdout', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result('done\n'))

		const result = await git_gh_exec.exec_gh_command_with_stdin({
			args: ['api', 'repos/o/r/pulls', '--input', BODY_FROM_STDIN],
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
// read that failed (403, 429, a dropped connection). The read reports a failure as gh's stderr text
// — GraphQL before joshuafolkken/kit#1024, `exec_gh_api`'s thrown Error since — so the status comes
// from this probe, read from the status line `--include` prints and never from `gh`'s wording,
// which is prose that can be reworded between releases.
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
			Object.assign(new Error(GH_FAILED), { stdout: NOT_FOUND_LINE, stderr: NOT_FOUND_STDERR }),
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

// joshuafolkken/kit#1023: the `gh <noun> <verb>` form goes through GraphQL, which a cloud session is
// refused (403), while repository-scoped REST is allowed. `exec_gh_api` is the single entry point
// every converted call site goes through, so the verb, the body and the paging are described once
// here rather than spelled out per call site.
const API_PATH = 'repos/o/r'
const API_BODY = '{"title":"t"}'
const EMPTY_OBJECT = '{}'
const EMPTY_LISTING = '[]'
const POST_METHOD = 'POST'
const REPO_FULL_NAME = 'o/r'
const FULL_NAME_FILTER = '.full_name'
const PAGINATE_FLAG = '--paginate'

describe('exec_gh_api — the request it builds', () => {
	it('makes a plain GET when nothing but the path is given', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH])
	})

	it('names another verb with --method', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH, method: 'PATCH' })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH, '--method', 'PATCH'])
	})

	// The body goes in on stdin so a JSON payload needs no temporary file and no per-field escaping.
	it('passes a request body on stdin and points gh at it with --input -', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH, method: POST_METHOD, body: API_BODY })

		expect(mocked_execa).toHaveBeenCalledWith(
			'gh',
			['api', API_PATH, '--method', POST_METHOD, '--input', BODY_FROM_STDIN],
			{ input: API_BODY },
		)
	})
})

describe('exec_gh_api — the optional flags', () => {
	it('asks for every page with --paginate', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_LISTING))

		await git_gh_exec.exec_gh_api({ path: API_PATH, should_paginate: true })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH, PAGINATE_FLAG])
	})

	it('omits --paginate when the caller says false', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_LISTING))

		await git_gh_exec.exec_gh_api({ path: API_PATH, should_paginate: false })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH])
	})

	it('unwraps one field with --jq', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(REPO_FULL_NAME))

		await git_gh_exec.exec_gh_api({ path: API_PATH, jq_filter: FULL_NAME_FILTER })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH, '--jq', FULL_NAME_FILTER])
	})
})

describe('exec_gh_api — output and failure handling', () => {
	it('returns the response body with trailing whitespace removed', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(`${REPO_FULL_NAME}\n`))

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).resolves.toBe(REPO_FULL_NAME)
	})

	// Unchanged from the `gh <noun> <verb>` calls this replaces: `to_gh_error` makes gh's stderr the
	// thrown message, and converting a call site must not change what its caller catches.
	it(THROWS_STDERR_CASE, async () => {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), { stderr: `${NOT_FOUND_STDERR}\n` }),
		)

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).rejects.toThrow(NOT_FOUND_STDERR)
	})

	// The stdin path throws through the same converter, which a body-carrying call must not bypass.
	it('throws with the stderr text when a request carrying a body fails', async () => {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), { stderr: `${NOT_FOUND_STDERR}\n` }),
		)

		await expect(
			git_gh_exec.exec_gh_api({ path: API_PATH, method: POST_METHOD, body: API_BODY }),
		).rejects.toThrow(NOT_FOUND_STDERR)
	})

	it('propagates the gh-not-installed error', async () => {
		mocked_check.mockRejectedValueOnce(new Error(GH_NOT_INSTALLED_MSG))

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).rejects.toThrow(GH_NOT_INSTALLED_MSG)
	})
})

// gh emits one JSON document per page under `--paginate`, so a caller that means to parse the
// result asks for `--slurp` as well; the two are separate because gh refuses `--slurp` beside
// `--jq`, which a caller reading one value per page needs.
describe('exec_gh_api — paging a listing that will be parsed', () => {
	it('wraps the pages in one array with --slurp', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_LISTING))

		await git_gh_exec.exec_gh_api({ path: API_PATH, should_paginate: true, should_slurp: true })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH, PAGINATE_FLAG, '--slurp'])
	})

	it('omits --slurp when the caller does not ask for it', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_LISTING))

		await git_gh_exec.exec_gh_api({ path: API_PATH, should_paginate: true, should_slurp: false })

		expect(mocked_execa).toHaveBeenCalledWith('gh', ['api', API_PATH, PAGINATE_FLAG])
	})
})
