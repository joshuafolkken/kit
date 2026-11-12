import { token_shape_fixture } from '#scripts/lib/token-shape-fixture'
import { execa, execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GH_REQUEST_TIMEOUT_MESSAGE, GH_REQUEST_TIMEOUT_MS, git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { gh_retry } from './git-gh-retry'

// How `git_gh_exec` fails: the nature a failure carries, the request budget, the retry of a transient
// failure and the refusal of a body holding a credential. Kept apart from `git-gh-exec.test.ts`,
// which is at the 300 lines a file may hold.

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

// execa's resolved Result is a large interface; these tests only need `stdout`, so a minimal stub is
// bridged through `unknown` — the same shape `git-gh-exec.test.ts` uses.
function fake_stdout_result(stdout: string): ExecaResult {
	const result = { stdout }

	return result as unknown as ExecaResult
}

const PR_VIEW_ARGS = ['pr', 'view']
const GH_FAILED = 'failed'
const NOT_FOUND_STATUS = 404
const NOT_FOUND_STDERR = 'gh: Not Found'
const NOT_FOUND_BODY = '{"message":"Not Found","status":"404"}'
const CONNECTION_STDERR = 'error connecting to api.github.com'
const COMMENTS_PATH = 'repos/o/r/issues/1/comments'
const REPO_PATH = 'repos/o/r'
const API_BODY = '{"title":"t"}'
const EMPTY_OBJECT = '{}'
const POST_METHOD = 'POST'
const ISSUE_PATH = 'repos/o/r/issues/1'
const OK_LINE = 'HTTP/2.0 200 OK\nServer: github.com\n'
const TIMEOUT_OPTION = { timeout: GH_REQUEST_TIMEOUT_MS }
const BAD_GATEWAY = 'gh: Server Error (HTTP 502)'
const POSTED = '{"id":1}'

beforeEach(() => {
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

function reject_with(stderr: string, stdout: string): void {
	mocked_execa.mockRejectedValueOnce(Object.assign(new Error(GH_FAILED), { stderr, stdout }))
}

async function thrown_by_gh(): Promise<unknown> {
	try {
		await git_gh_exec.exec_gh_command(PR_VIEW_ARGS)
	} catch (error_) {
		return error_
	}

	return undefined
}

// joshuafolkken/kit#1690: the same stdout that carries the diagnosis carries the status GitHub
// answered with, so the failed request describes itself and no second one has to be spent asking.
describe('to_gh_error — the failure nature it attaches', () => {
	it('carries the status GitHub wrote in its own error document', async () => {
		reject_with(`${NOT_FOUND_STDERR}\n`, `${NOT_FOUND_BODY}\n`)

		expect(gh_failure.failure_of(await thrown_by_gh())).toEqual({ status: NOT_FOUND_STATUS })
	})

	// A request that never arrived wrote no response body, so there is no status to report — which is
	// exactly what the transport case has to look like.
	it('carries no status when nothing answered the request', async () => {
		reject_with(CONNECTION_STDERR, '')

		expect(gh_failure.failure_of(await thrown_by_gh())).toEqual({ status: undefined })
	})

	// The annotation must not change what an equality check, a log or a serializer sees.
	it('leaves the message it already built untouched', async () => {
		reject_with(`${NOT_FOUND_STDERR}\n`, '')

		await expect(git_gh_exec.exec_gh_command(PR_VIEW_ARGS)).rejects.toThrow(
			new Error(NOT_FOUND_STDERR),
		)
	})
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
// single-threaded runner most visibly, and `followup`, whose repeated CI reads freeze on the first
// request that never answers.
const OVERRIDE_TIMEOUT_MS = 5000

describe('the request budget — the default every entry carries', () => {
	it('bounds a plain REST read', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: REPO_PATH })

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), TIMEOUT_OPTION)
	})

	it('bounds a REST request that carries a body', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({ path: REPO_PATH, method: POST_METHOD, body: API_BODY })

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

		await git_gh_exec.exec_gh_api({ path: REPO_PATH, timeout_ms: OVERRIDE_TIMEOUT_MS })

		expect(mocked_execa).toHaveBeenCalledWith('gh', expect.any(Array), {
			timeout: OVERRIDE_TIMEOUT_MS,
		})
	})

	// The body path is a different spawn helper, so the override has to travel to it too.
	it('uses the request field instead of the default on a write', async () => {
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(EMPTY_OBJECT))

		await git_gh_exec.exec_gh_api({
			path: REPO_PATH,
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

		await expect(git_gh_exec.exec_gh_api({ path: REPO_PATH })).rejects.toThrow(
			GH_REQUEST_TIMEOUT_MESSAGE,
		)
	})

	it('says it timed out even when gh had already written to stderr', async () => {
		reject_as_timed_out(`${NOT_FOUND_STDERR}\n`)

		await expect(git_gh_exec.exec_gh_api({ path: REPO_PATH })).rejects.toThrow(
			`${GH_REQUEST_TIMEOUT_MESSAGE}: ${NOT_FOUND_STDERR}`,
		)
	})

	// The label belongs to a killed spawn only; an ordinary non-zero exit must read as it always did.
	// Asked of the transport, which `exec_gh_api` shares, because a failure carrying no status is one
	// `exec_gh_api` asks again (`git-gh-retry.ts`).
	it('leaves an ordinary failure unlabelled', async () => {
		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(GH_FAILED), { stderr: `${NOT_FOUND_STDERR}\n`, timedOut: false }),
		)

		await expect(git_gh_exec.exec_gh_command(['api', REPO_PATH])).rejects.toThrow(
			new Error(NOT_FOUND_STDERR),
		)
	})
})

function reject_bad_gateway(): void {
	mocked_execa.mockRejectedValueOnce(
		Object.assign(new Error(GH_FAILED), { stderr: `${BAD_GATEWAY}\n`, stdout: '' }),
	)
}

// joshuafolkken/kit#4717: every REST request through `exec_gh_api` — `review:record --comment` and
// the pull-request writes `josh ship` makes — survives a transient 502 instead of stopping the stage.
describe('exec_gh_api — a transient GitHub failure', () => {
	it('posts on the retry after a 502 and writes one log line', async () => {
		reject_bad_gateway()
		mocked_execa.mockResolvedValueOnce(fake_stdout_result(POSTED))

		await expect(
			git_gh_exec.exec_gh_api({ path: COMMENTS_PATH, method: 'POST', body: '{"body":"x"}' }),
		).resolves.toBe(POSTED)
		expect(mocked_execa).toHaveBeenCalledTimes(2)
		expect(process.stderr.write).toHaveBeenCalledTimes(1)
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(BAD_GATEWAY))
	})

	it('throws the 502 once every attempt failed', async () => {
		for (let attempt = 0; attempt < gh_retry.MAX_ATTEMPTS; attempt += 1) reject_bad_gateway()

		await expect(git_gh_exec.exec_gh_api({ path: COMMENTS_PATH })).rejects.toThrow(BAD_GATEWAY)
		expect(mocked_execa).toHaveBeenCalledTimes(gh_retry.MAX_ATTEMPTS)
	})

	// An issue creation that 502s may already have opened the issue; asking again would open a second.
	it('sends a request that opts out of retrying only once', async () => {
		reject_bad_gateway()

		await expect(
			git_gh_exec.exec_gh_api({ path: COMMENTS_PATH, body: '{"title":"x"}', should_retry: false }),
		).rejects.toThrow(BAD_GATEWAY)
		expect(mocked_execa).toHaveBeenCalledTimes(1)
		expect(process.stderr.write).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4658: every Issue and pull-request body kit writes goes through `gh api`, so a
// body holding a credential is refused there, before gh is spawned.
const SAMPLE = token_shape_fixture.sample_of('GitHub token')
const REFUSED_CASE = 'is refused before gh is spawned, $position'
const REFUSAL = `The gh api ${COMMENTS_PATH} body holds a GitHub token-shaped string`

// The writers JSON-encode the body, so a token that starts a line, a nested field or a whole body sits
// right after an escape or a quote — the positions a scan of the encoded text would miss.
const LEAKING_BODIES = [
	{ position: 'after `=`', body: JSON.stringify({ body: `export GH_TOKEN=${SAMPLE}\n` }) },
	{
		position: 'at the start of a line',
		body: JSON.stringify({ body: `Ran it with\n${SAMPLE}\n` }),
	},
	{ position: 'after a tab', body: JSON.stringify({ body: `token:\t${SAMPLE}` }) },
	{ position: 'in a nested field', body: JSON.stringify({ input: { text: `\n${SAMPLE}` } }) },
	{ position: 'as a non-JSON body', body: `Ran it with\n${SAMPLE}\n` },
]

describe('exec_gh_api — a body holding a credential', () => {
	it.each(LEAKING_BODIES)(REFUSED_CASE, async ({ body }) => {
		await expect(git_gh_exec.exec_gh_api({ path: COMMENTS_PATH, body })).rejects.toThrow(REFUSAL)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('exec_gh_api_sync — a body holding a credential', () => {
	it.each(LEAKING_BODIES)(REFUSED_CASE, ({ body }) => {
		expect(() => git_gh_exec.exec_gh_api_sync({ path: COMMENTS_PATH, body })).toThrow(REFUSAL)
		expect(vi.mocked(execaSync)).not.toHaveBeenCalled()
	})
})
