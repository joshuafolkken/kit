import { run_ship_infra_retry } from '#scripts/run/ship/run-ship-infra-retry'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { gh_request_tally } from './gh-request-tally'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_poll_read } from './git-gh-poll-read'
import { gh_retry } from './git-gh-retry'

// joshuafolkken/kit#3773: the issue watch polls with `If-None-Match`, and `gh` reports a 304 by
// exiting non-zero. The status has to be read off the failure's `--include` stdout, so a 304 is
// "unchanged" while every other failure stays "unreadable".

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))

const PATH = 'repos/o/r/issues/3773'
const ETAG = 'W/"abc"'
const NEW_ETAG = 'W/"def"'
const BODY = '{"state":"open"}'
const TIMEOUT_MS = 5000
const UNREADABLE: ConditionalRead = { kind: 'unreadable' }
const CHECK_RUNS_PATH = 'repos/o/r/commits/head/check-runs?per_page=100'
const OK = 'HTTP/2.0 200 OK\nETag: fresh\n\n{"total_count":0}'
const NOT_MODIFIED = 'HTTP/2.0 304 Not Modified\n\n'
const FORBIDDEN = 'HTTP/2.0 403 Forbidden\n\n{}'
const STATUSES = [500, 502, 503] as const

function mocked_command(): MockInstance<typeof git_gh_exec.exec_gh_command> {
	return vi.spyOn(git_gh_exec, 'exec_gh_command')
}

function failure_with_stdout(stdout: string): Error {
	return new Error('gh: HTTP failure', { cause: Object.assign(new Error('exit 1'), { stdout }) })
}

async function read(): Promise<ConditionalRead> {
	return await git_gh_conditional.read_conditional(PATH, ETAG)
}

function failure(status: number): Error {
	const cause = Object.assign(new Error('exit 1'), {
		stdout: `HTTP/2.0 ${String(status)} Failed\n\n{}`,
	})

	return gh_failure.attach(new Error(`gh: HTTP ${String(status)}`, { cause }), {
		status: undefined,
	})
}

function timeout(stdout: string): Error {
	const cause = Object.assign(new Error('timeout'), { timedOut: true, stdout })

	return gh_failure.attach(new Error('gh api timed out after 30s', { cause }), {
		status: undefined,
	})
}

async function failed_read(): Promise<unknown> {
	try {
		return await git_gh_poll_read.read(CHECK_RUNS_PATH)
	} catch (error) {
		return error
	}
}

beforeEach(() => {
	git_gh_poll_read.forget_poll_reads()
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_gh_conditional.to_args', () => {
	it('sends If-None-Match only when an etag is given', () => {
		expect(git_gh_conditional.to_args(PATH, ETAG)).toStrictEqual([
			'api',
			'--include',
			'-H',
			`If-None-Match: ${ETAG}`,
			PATH,
		])
		expect(git_gh_conditional.to_args(PATH, undefined)).toStrictEqual(['api', '--include', PATH])
	})
})

describe('git_gh_conditional.read_conditional — a 200', () => {
	it('answers changed with the etag and the body', async () => {
		const command = mocked_command().mockResolvedValueOnce(
			`HTTP/2.0 200 OK\r\nETag: ${NEW_ETAG}\r\n\r\n${BODY}`,
		)
		const answer = await git_gh_conditional.read_conditional(PATH, ETAG, TIMEOUT_MS)

		expect(answer).toStrictEqual({ kind: 'changed', etag: NEW_ETAG, body: BODY })
		expect(command).toHaveBeenCalledWith(git_gh_conditional.to_args(PATH, ETAG), TIMEOUT_MS)
	})

	it('answers changed without an etag when the header is missing', async () => {
		mocked_command().mockResolvedValueOnce(`HTTP/2.0 200 OK\n\n${BODY}`)

		await expect(git_gh_conditional.read_conditional(PATH, undefined)).resolves.toStrictEqual({
			kind: 'changed',
			etag: undefined,
			body: BODY,
		})
	})
})

describe('git_gh_conditional.read_conditional — everything else', () => {
	it('answers unchanged on a 304 carried by the failure', async () => {
		mocked_command().mockRejectedValueOnce(failure_with_stdout(NOT_MODIFIED))

		await expect(read()).resolves.toStrictEqual({ kind: 'unchanged' })
	})

	it('counts a 304 as not modified, and no other failure', async () => {
		gh_request_tally.reset()
		mocked_command()
			.mockRejectedValueOnce(failure_with_stdout(NOT_MODIFIED))
			.mockRejectedValueOnce(failure_with_stdout(FORBIDDEN))

		await read()
		await read()

		expect(gh_request_tally.snapshot().not_modified).toBe(1)
		expect(gh_request_tally.snapshot().endpoints).toStrictEqual({
			'GET repos/{o}/{r}/issues/{n}': { calls: 0, not_modified: 1 },
		})
	})

	it('answers unreadable on any other failure, carrying gh failure as the cause', async () => {
		const forbidden = failure_with_stdout(FORBIDDEN)
		const network = new Error('network down')

		mocked_command().mockRejectedValueOnce(forbidden).mockRejectedValueOnce(network)

		await expect(read()).resolves.toStrictEqual({ kind: 'unreadable', cause: forbidden })
		await expect(read()).resolves.toStrictEqual({ kind: 'unreadable', cause: network })
	})

	it('answers unreadable on a non-200 success', async () => {
		mocked_command().mockResolvedValueOnce(`HTTP/2.0 202 Accepted\n\n${BODY}`)

		await expect(read()).resolves.toStrictEqual(UNREADABLE)
	})
})

describe('conditional merge-gate reads — #5473', () => {
	it.each(STATUSES)('recovers from HTTP %s on the same conditional read', async (status) => {
		const command = mocked_command().mockRejectedValueOnce(failure(status)).mockResolvedValue(OK)
		const result = git_gh_conditional.read_conditional(CHECK_RUNS_PATH, 'previous')

		await expect(result).resolves.toMatchObject({ kind: 'changed', etag: 'fresh' })
		expect(command).toHaveBeenCalledTimes(2)
		expect(command.mock.calls[0]).toStrictEqual(command.mock.calls[1])
	})

	it.each(['', 'HTTP/2.0 200 OK\n\n{"total_count":', '{"total_count":'])(
		'retries a read timeout with partial stdout %j without retrying a write',
		async (stdout) => {
			const error = timeout(stdout)
			const command = mocked_command()
				.mockRejectedValueOnce(error)
				.mockRejectedValueOnce(error)
				.mockResolvedValue(OK)
			const result = git_gh_conditional.read_conditional(CHECK_RUNS_PATH, undefined)

			await expect(result).resolves.toMatchObject({ kind: 'changed' })
			expect(command).toHaveBeenCalledTimes(gh_retry.MAX_ATTEMPTS)
			expect(gh_retry.is_transient(error)).toBe(false)
		},
	)

	it('stops at the first timeout of a read the caller bounds', async () => {
		const error = timeout('')
		const command = mocked_command().mockRejectedValue(error)
		const result = git_gh_conditional.read_conditional(CHECK_RUNS_PATH, undefined, TIMEOUT_MS)

		await expect(result).resolves.toStrictEqual({ kind: 'unreadable', cause: error })
		expect(command).toHaveBeenCalledTimes(1)
	})
})

describe('conditional merge-gate reads — final failures', () => {
	it.each([401, 403])('stops on HTTP %s without retrying', async (status) => {
		const error = failure(status)
		const command = mocked_command().mockRejectedValue(error)

		await expect(
			git_gh_conditional.read_conditional(CHECK_RUNS_PATH, undefined),
		).resolves.toStrictEqual({ kind: 'unreadable', cause: error })
		expect(command).toHaveBeenCalledTimes(1)
	})

	it.each(STATUSES)(
		'returns an exhausted HTTP %s read to the existing bounded stage retry',
		async (status) => {
			mocked_command().mockRejectedValue(failure(status))
			const error = await failed_read()
			const notes = vi
				.mocked(process.stderr.write)
				.mock.calls.map(([text]) => String(text))
				.join('')
			const body = `${notes}\n❌ Error: ${String(error)}\n💡 Details: gh: HTTP ${String(status)}`
			const stopped = { header: 'followup', body, out: '', code: 1 }
			const attempt = vi.fn().mockResolvedValue(stopped)

			await expect(
				run_ship_infra_retry.retried('followup', attempt, {
					wait: async () => undefined,
					note: () => undefined,
				}),
			).resolves.toBe(stopped)
			expect(attempt).toHaveBeenCalledTimes(run_ship_infra_retry.MAX_INFRA_RETRIES + 1)
			expect(git_gh_exec.exec_gh_command).toHaveBeenCalledTimes(gh_retry.MAX_ATTEMPTS)
		},
	)
})
