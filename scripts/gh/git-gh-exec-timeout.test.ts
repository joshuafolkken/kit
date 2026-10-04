import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GH_REQUEST_TIMEOUT_MESSAGE, GH_REQUEST_TIMEOUT_MS, git_gh_exec } from './git-gh-exec'

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

// execa's resolved Result is a large interface; these tests only need `stdout`, so a minimal stub is
// bridged through `unknown` — the same shape `git-gh-exec.test.ts` uses.
function fake_stdout_result(stdout: string): ExecaResult {
	const result = { stdout }

	return result as unknown as ExecaResult
}

const API_PATH = 'repos/o/r'
const API_BODY = '{"title":"t"}'
const EMPTY_OBJECT = '{}'
const POST_METHOD = 'POST'
const ISSUE_PATH = 'repos/o/r/issues/1'
const OK_LINE = 'HTTP/2.0 200 OK\nServer: github.com\n'
const NOT_FOUND_STDERR = 'gh: Not Found'
const GH_FAILED = 'failed'
const TIMEOUT_OPTION = { timeout: GH_REQUEST_TIMEOUT_MS }

// Split out of `git-gh-exec.test.ts` for the reason `git-gh-exec-sync.test.ts` was: that file is at
// the 300 lines a file may hold.

beforeEach(() => {
	vi.clearAllMocks()
})

// The helper is at module scope because a `describe`-scoped function is refused by
// `unicorn/consistent-function-scoping`.
function reject_as_timed_out(stderr: string): void {
	mocked_execa.mockRejectedValueOnce(
		Object.assign(new Error('Command timed out after 60000 milliseconds: gh api'), {
			stderr,
			timedOut: true,
		}),
	)
}

// joshuafolkken/kit#1065: every GitHub access kit makes funnels through this layer, and none of its
// entries bounded a request. A hung `gh` therefore held its caller open forever — `josh propagate`'s
// single-threaded runner most visibly, and `followup`, which makes roughly 573 requests across a
// 32-minute CI wait and freezes on the first one that never answers.
const OVERRIDE_TIMEOUT_MS = 5000

describe('the request budget — the default every entry carries', () => {
	it('bounds a plain REST read', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH })

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), TIMEOUT_OPTION)
	})

	it('bounds a REST request that carries a body', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH, method: POST_METHOD, body: API_BODY })

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), {
			input: API_BODY,
			timeout: GH_REQUEST_TIMEOUT_MS,
		})
	})

	// The fifth spawn in the module, and not one of the four the Issue enumerated. Leaving it
	// unbounded beside four bounded ones is the inconsistency that Issue argues against.
	it('bounds the status probe as well', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(OK_LINE))

		await git_gh_exec.exec_gh_api_status(ISSUE_PATH)

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), TIMEOUT_OPTION)
	})
})

describe('the request budget — a caller overriding it', () => {
	it('uses the request field instead of the default on a read', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: API_PATH, timeout_ms: OVERRIDE_TIMEOUT_MS })

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), {
			timeout: OVERRIDE_TIMEOUT_MS,
		})
	})

	// The body path is a different spawn helper, so the override has to travel to it too.
	it('uses the request field instead of the default on a write', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({
			path: API_PATH,
			method: POST_METHOD,
			body: API_BODY,
			timeout_ms: OVERRIDE_TIMEOUT_MS,
		})

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), {
			input: API_BODY,
			timeout: OVERRIDE_TIMEOUT_MS,
		})
	})
})

// **A timeout is a failure, not an answer.** It travels the same path every other failure does —
// `to_gh_error` — so nothing downstream gains a way to read "nobody answered" as "there is nothing".
// What it gains is a label: without it, a hang that had written one line to stderr first would be
// reported as whatever that line happened to say (joshuafolkken/kit#1048's distinction).
describe('a request that ran out of time', () => {
	it('throws rather than resolving to an empty answer', async () => {
		reject_as_timed_out('')

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).rejects.toThrow(
			GH_REQUEST_TIMEOUT_MESSAGE,
		)
	})

	it('says it timed out even when gh had already written to stderr', async () => {
		reject_as_timed_out(`${NOT_FOUND_STDERR}\n`)

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).rejects.toThrow(
			`${GH_REQUEST_TIMEOUT_MESSAGE}: ${NOT_FOUND_STDERR}`,
		)
	})

	// The label belongs to a killed spawn only; an ordinary non-zero exit must read as it always did.
	it('leaves an ordinary failure unlabelled', async () => {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), { stderr: `${NOT_FOUND_STDERR}\n`, timedOut: false }),
		)

		await expect(git_gh_exec.exec_gh_api({ path: API_PATH })).rejects.toThrow(
			new Error(NOT_FOUND_STDERR),
		)
	})
})
