import { execa, execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_core_rate_limit } from './gh-core-rate-limit'
import { gh_request_tally } from './gh-request-tally'
import { gh_spawn } from './gh-spawn'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'

// joshuafolkken/kit#6694: every spawn of `gh` in the exec layer counts one call — on each entry,
// whether it succeeded or failed, and once per retry — while what `exec_gh_api` answers and throws
// stays exactly what it was.

vi.mock('execa', () => ({ execa: vi.fn(), execaSync: vi.fn() }))
vi.mock('./git-gh-check', () => ({ check_gh_installed: vi.fn() }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))
vi.mock('#scripts/init/init-paths', () => ({ PROJECT_ROOT: '/fake/root' }))

const mocked_execa = vi.mocked(execa)
const mocked_execa_sync = vi.mocked(execaSync)

type ExecaResult = Awaited<ReturnType<typeof execa>>
type ExecaSyncResult = ReturnType<typeof execaSync>

const PATH = 'repos/o/r/issues/1'
const STATUS_OK = 'HTTP/2.0 200 OK\n'
const OK_STATUS = 200
const SERVER_ERROR_BODY = '{"message":"Server Error","status":"502"}'
const VALIDATION_SUMMARY = 'gh: Validation Failed (HTTP 422)'
const VALIDATION_BODY = '{"message":"Validation Failed","status":"422"}'
const VALIDATION_STATUS = 422
const RETRY_ATTEMPTS = 3
const ISSUE_KIND = 'GET repos/{o}/{r}/issues/{n}'
const RATE_LIMIT_ARGS = ['api', 'rate_limit', '--jq', '.resources.core']

// execa's Result types are large interfaces; these tests only read `stdout`.
function async_result(stdout: string): ExecaResult {
	return { stdout } as unknown as ExecaResult
}

function sync_result(stdout: string): ExecaSyncResult {
	return { stdout } as unknown as ExecaSyncResult
}

function spawn_failure(stdout: string, stderr = ''): Error {
	return Object.assign(new Error('Command failed with exit code 1'), { stdout, stderr })
}

function core_reading(used: number): string {
	return JSON.stringify({ limit: 5000, used, remaining: 5000 - used, reset: 1_793_000_000 })
}

function calls(): number {
	return gh_request_tally.snapshot().calls
}

function kinds(): Array<string> {
	return Object.keys(gh_request_tally.snapshot().endpoints)
}

async function rejection_of(request: Promise<unknown>): Promise<unknown> {
	try {
		return await request
	} catch (error) {
		return error
	}
}

beforeEach(() => {
	gh_request_tally.reset()
	mocked_execa.mockReset()
	mocked_execa_sync.mockReset()
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

describe('gh_request_tally — one count per spawn on each entry', () => {
	it('counts the async command path once', async () => {
		mocked_execa.mockResolvedValueOnce(async_result('ok'))

		await git_gh_exec.exec_gh_command(['api', PATH])

		expect(calls()).toBe(1)
	})

	it('counts the stdin path once', async () => {
		mocked_execa.mockResolvedValueOnce(async_result('ok'))

		await git_gh_exec.exec_gh_command_with_stdin({ args: ['api', PATH], stdin_body: '{}' })

		expect(calls()).toBe(1)
	})

	it('counts the async status probe once', async () => {
		mocked_execa.mockResolvedValueOnce(async_result(STATUS_OK))

		await expect(git_gh_exec.exec_gh_api_status(PATH)).resolves.toBe(OK_STATUS)
		expect(calls()).toBe(1)
	})

	it('counts the sync status probe once', () => {
		mocked_execa_sync.mockReturnValueOnce(sync_result(STATUS_OK))

		expect(git_gh_exec.exec_gh_api_status_sync(PATH)).toBe(OK_STATUS)
		expect(calls()).toBe(1)
	})

	it('counts the sync request path once, and gh_spawn through it once', () => {
		mocked_execa_sync.mockReturnValue(sync_result('o/r'))

		git_gh_exec.exec_gh_api_sync({ path: PATH })
		gh_spawn.get_repo_name_with_owner()

		expect(calls()).toBe(2)
	})
})

// joshuafolkken/kit#6867: each entry counts its call under the call's kind.
describe('gh_request_tally — the kind each entry counts under', () => {
	it('counts a command and a stdin write under their method and normalized path', async () => {
		mocked_execa.mockResolvedValue(async_result('ok'))

		await git_gh_exec.exec_gh_command(['api', PATH])
		await git_gh_exec.exec_gh_command_with_stdin({
			args: ['api', PATH, '--method', 'PATCH', '--input', '-'],
			stdin_body: '{}',
		})

		expect(kinds()).toStrictEqual([ISSUE_KIND, 'PATCH repos/{o}/{r}/issues/{n}'])
	})

	it('counts both status probes as a GET of their path', async () => {
		mocked_execa.mockResolvedValueOnce(async_result(STATUS_OK))
		mocked_execa_sync.mockReturnValueOnce(sync_result(STATUS_OK))

		await git_gh_exec.exec_gh_api_status(PATH)
		git_gh_exec.exec_gh_api_status_sync(PATH)

		expect(gh_request_tally.snapshot().endpoints).toStrictEqual({
			[ISSUE_KIND]: { calls: 2, not_modified: 0 },
		})
	})

	it('counts a sync request with a body as a POST, and a subcommand by its name', async () => {
		mocked_execa_sync.mockReturnValueOnce(sync_result('{}'))
		mocked_execa.mockResolvedValueOnce(async_result('{}'))

		git_gh_exec.exec_gh_api_sync({ path: 'repos/o/r/issues/1/comments', body: '{}' })
		await git_gh_exec.exec_gh_command(['issue', 'view', '1', '--json', 'title'])

		expect(kinds()).toStrictEqual(['POST repos/{o}/{r}/issues/{n}/comments', 'gh issue view'])
	})
})

describe('gh_request_tally — failed and retried spawns', () => {
	it('counts a spawn that failed', async () => {
		mocked_execa.mockRejectedValueOnce(spawn_failure(VALIDATION_BODY, VALIDATION_SUMMARY))
		mocked_execa_sync.mockImplementationOnce(() => {
			throw spawn_failure('')
		})

		await expect(git_gh_exec.exec_gh_command(['api', PATH])).rejects.toThrow(VALIDATION_SUMMARY)
		expect(git_gh_exec.read_gh_api_sync({ path: PATH })).toBeUndefined()
		expect(calls()).toBe(2)
	})

	it('counts every retried spawn of exec_gh_api', async () => {
		mocked_execa.mockRejectedValue(spawn_failure(SERVER_ERROR_BODY))

		await expect(git_gh_exec.exec_gh_api({ path: PATH })).rejects.toThrow('Command failed')
		expect(calls()).toBe(RETRY_ATTEMPTS)
	})
})

describe('gh_request_tally — the core allowance reading', () => {
	it('reads rate_limit through the uncounted spawn around a counted call', async () => {
		// The start reading spawns first, inside the counted call, before the request's own spawn.
		mocked_execa
			.mockResolvedValueOnce(async_result(core_reading(10)))
			.mockResolvedValueOnce(async_result('ok'))
			.mockResolvedValueOnce(async_result(core_reading(14)))
		gh_request_tally.watch_core(gh_core_rate_limit.read_usage)

		await git_gh_exec.exec_gh_api({ path: PATH })

		await expect(gh_request_tally.core_delta()).resolves.toBe(4)
		expect(calls()).toBe(1)
		expect(mocked_execa).toHaveBeenNthCalledWith(1, 'gh', RATE_LIMIT_ARGS, expect.anything())
		expect(mocked_execa).toHaveBeenNthCalledWith(2, 'gh', ['api', PATH], expect.anything())
		expect(mocked_execa).toHaveBeenNthCalledWith(3, 'gh', RATE_LIMIT_ARGS, expect.anything())
	})
})

describe('exec_gh_api — answers and failures unchanged by the count', () => {
	it('answers the trimmed stdout, after a retried spawn too', async () => {
		mocked_execa
			.mockRejectedValueOnce(spawn_failure(SERVER_ERROR_BODY))
			.mockResolvedValueOnce(async_result('{"id":1}\n'))

		await expect(git_gh_exec.exec_gh_api({ path: PATH })).resolves.toBe('{"id":1}')
		expect(calls()).toBe(2)
	})

	it('throws stderr with the stdout body, classified by the status gh wrote', async () => {
		const spawn_error = spawn_failure(VALIDATION_BODY, VALIDATION_SUMMARY)

		mocked_execa.mockRejectedValueOnce(spawn_error)

		const error = await rejection_of(git_gh_exec.exec_gh_api({ path: PATH }))

		expect(error).toBeInstanceOf(Error)
		expect(error).toHaveProperty('message', `${VALIDATION_SUMMARY}\n${VALIDATION_BODY}`)
		expect(error).toHaveProperty('cause', spawn_error)
		expect(gh_failure.failure_of(error)).toStrictEqual({ status: VALIDATION_STATUS })
	})
})
