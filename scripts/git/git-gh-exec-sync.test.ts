import { execa, execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	BODY_FROM_STDIN,
	GH_REQUEST_TIMEOUT_MESSAGE,
	GH_REQUEST_TIMEOUT_MS,
	git_gh_exec,
} from './git-gh-exec'

// joshuafolkken/kit#1042: `josh propagate` opens its consumer's upgrade issue from a synchronous
// step chain and cannot await, so the last `gh <noun> <verb>` spawn in kit's own code is replaced by
// a REST request that runs through `execaSync`. The twin exists so that call site shares the
// argument builder and the error translation rather than defining a second way to write through gh.
//
// Split into its own file because `git-gh-exec.test.ts` was already within a few lines of the 300 a
// file may hold — the same reason the write side was split out of `git-gh-issue.ts`.

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const mocked_execa = vi.mocked(execa)
const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

// execa's synchronous Result is a large interface and these tests only need `stdout`, so a minimal
// stub is bridged through `unknown` — the same shape `git-gh-exec.test.ts` uses for the
// asynchronous Result, which is a different type and cannot be the same stub.
function fake_sync_result(stdout: string): ExecaSyncResult {
	const result = { stdout }

	return result as unknown as ExecaSyncResult
}

const API_PATH = 'repos/o/r/issues'
const API_BODY = '{"title":"t"}'
const HTML_URL_FILTER = '.html_url'
const ISSUE_URL = 'https://github.com/o/r/issues/1'
const GH_FAILED = 'failed'
const VALIDATION_SUMMARY = 'gh: Validation Failed (HTTP 422)'
const VALIDATION_BODY = '{"message":"Validation Failed","errors":[{"field":"title"}]}'
const MULTILINE_BODY = '{"title":"t","body":"first line\\n\\n- second `line`\\n"}'

beforeEach(() => {
	vi.clearAllMocks()
})

describe('exec_gh_api_sync — the body never becomes an argument', () => {
	// The whole reason the asynchronous path uses `--input -`: an issue body is multi-line markdown,
	// and passing it as an argument would make it depend on how the value survives being spelled out
	// on a command line. `execaSync` accepts `input`, so the synchronous twin keeps that property.
	it('hands the body to gh on stdin rather than among the arguments', () => {
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(ISSUE_URL))

		git_gh_exec.exec_gh_api_sync({ path: API_PATH, body: MULTILINE_BODY })

		expect(mocked_execa_sync).toHaveBeenCalledWith(
			'gh',
			['api', API_PATH, '--input', BODY_FROM_STDIN],
			{ input: MULTILINE_BODY, timeout: GH_REQUEST_TIMEOUT_MS },
		)
	})

	it('passes no stdin at all for a request that carries no body', () => {
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(ISSUE_URL))

		git_gh_exec.exec_gh_api_sync({ path: API_PATH, jq_filter: HTML_URL_FILTER })

		expect(mocked_execa_sync).toHaveBeenCalledWith(
			'gh',
			['api', API_PATH, '--jq', HTML_URL_FILTER],
			{ timeout: GH_REQUEST_TIMEOUT_MS },
		)
	})
})

describe('exec_gh_api_sync — one argument builder, two spawns', () => {
	// The twin is the same layer as `exec_gh_api`, not a second one. Asserting that the two ask gh for
	// the same thing is what would fail if either grew its own idea of how a request is built
	// (`CLAUDE.md` → "No clones").
	it('asks gh for exactly what the asynchronous path asks for', async () => {
		const request = { path: API_PATH, body: API_BODY, jq_filter: HTML_URL_FILTER }

		mocked_execa.mockResolvedValueOnce({ stdout: ISSUE_URL } as unknown as Awaited<
			ReturnType<typeof execa>
		>)
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(ISSUE_URL))
		await git_gh_exec.exec_gh_api(request)
		git_gh_exec.exec_gh_api_sync(request)

		const [, async_args] = mocked_execa.mock.calls[0] ?? []
		const [, sync_args] = mocked_execa_sync.mock.calls[0] ?? []

		expect(sync_args).toEqual(async_args)
	})
})

describe('exec_gh_api_sync — output and failure handling', () => {
	it('answers the response body with trailing whitespace removed', () => {
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(`${ISSUE_URL}\n`))

		expect(git_gh_exec.exec_gh_api_sync({ path: API_PATH })).toBe(ISSUE_URL)
	})

	// The same converter the asynchronous path throws through, so a failed REST write still states
	// its reason: the summary is on stderr and the JSON body naming the rejected field is on stdout
	// (joshuafolkken/kit#1029).
	it('throws with gh stderr summary and the JSON reason it wrote to stdout', () => {
		mocked_execa_sync.mockImplementationOnce(() => {
			throw Object.assign(new Error(GH_FAILED), {
				stderr: `${VALIDATION_SUMMARY}\n`,
				stdout: `${VALIDATION_BODY}\n`,
			})
		})

		expect(() => git_gh_exec.exec_gh_api_sync({ path: API_PATH, body: API_BODY })).toThrow(
			`${VALIDATION_SUMMARY}\n${VALIDATION_BODY}`,
		)
	})
})

// joshuafolkken/kit#1065: this is the entry `josh propagate`'s issue-creation step goes through, and
// the one place that step can be bounded in time. Every other propagation step is spawned through
// `spawn_step`, which passes `STEP_TIMEOUT_MS`; `open_issue` calls this directly, so before the
// budget below a hung `gh` blocked the single-threaded runner forever and no later consumer was
// processed at all.
const OVERRIDE_TIMEOUT_MS = 5000

describe('exec_gh_api_sync — the request budget', () => {
	it('bounds the write josh propagate opens its consumer issue with', () => {
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(ISSUE_URL))

		git_gh_exec.exec_gh_api_sync({ path: API_PATH, body: API_BODY })

		expect(mocked_execa_sync).toHaveBeenCalledWith('gh', expect.any(Array), {
			input: API_BODY,
			timeout: GH_REQUEST_TIMEOUT_MS,
		})
	})

	it('lets the caller override the budget through the request field', () => {
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(ISSUE_URL))

		git_gh_exec.exec_gh_api_sync({ path: API_PATH, timeout_ms: OVERRIDE_TIMEOUT_MS })

		expect(mocked_execa_sync).toHaveBeenCalledWith('gh', expect.any(Array), {
			timeout: OVERRIDE_TIMEOUT_MS,
		})
	})

	// The same direction the asynchronous twin takes: a timeout leaves as an exception, so the step
	// reports a failure rather than answering as though the write had succeeded.
	it('throws a labelled error when the spawn runs out of time', () => {
		mocked_execa_sync.mockImplementationOnce(() => {
			throw Object.assign(new Error('Command timed out'), { stderr: '', timedOut: true })
		})

		expect(() => git_gh_exec.exec_gh_api_sync({ path: API_PATH, body: API_BODY })).toThrow(
			GH_REQUEST_TIMEOUT_MESSAGE,
		)
	})
})
