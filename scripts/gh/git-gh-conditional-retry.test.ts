import { run_ship_infra_retry } from '#scripts/run/ship/run-ship-infra-retry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_poll_read } from './git-gh-poll-read'
import { gh_retry } from './git-gh-retry'

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))

const PATH = 'repos/o/r/commits/head/check-runs?per_page=100'
const OK = 'HTTP/2.0 200 OK\nETag: fresh\n\n{"total_count":0}'
const STATUSES = [500, 502, 503] as const

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
		return await git_gh_poll_read.read(PATH)
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

describe('conditional merge-gate reads — #5473', () => {
	it.each(STATUSES)('recovers from HTTP %s on the same conditional read', async (status) => {
		const command = vi
			.spyOn(git_gh_exec, 'exec_gh_command')
			.mockRejectedValueOnce(failure(status))
			.mockResolvedValue(OK)
		const result = git_gh_conditional.read_conditional(PATH, 'previous')

		await expect(result).resolves.toMatchObject({ kind: 'changed', etag: 'fresh' })
		expect(command).toHaveBeenCalledTimes(2)
		expect(command.mock.calls[0]).toStrictEqual(command.mock.calls[1])
	})

	it.each(['', 'HTTP/2.0 200 OK\n\n{"total_count":', '{"total_count":'])(
		'retries a read timeout with partial stdout %j without retrying a write',
		async (stdout) => {
			const error = timeout(stdout)
			const command = vi
				.spyOn(git_gh_exec, 'exec_gh_command')
				.mockRejectedValueOnce(error)
				.mockRejectedValueOnce(error)
				.mockResolvedValue(OK)
			const result = git_gh_conditional.read_conditional(PATH, undefined)

			await expect(result).resolves.toMatchObject({ kind: 'changed' })
			expect(command).toHaveBeenCalledTimes(gh_retry.MAX_ATTEMPTS)
			expect(gh_retry.is_transient(error)).toBe(false)
		},
	)
})

describe('conditional merge-gate reads — final failures', () => {
	it.each([401, 403])('stops on HTTP %s without retrying', async (status) => {
		const error = failure(status)
		const command = vi.spyOn(git_gh_exec, 'exec_gh_command').mockRejectedValue(error)

		await expect(git_gh_conditional.read_conditional(PATH, undefined)).resolves.toStrictEqual({
			kind: 'unreadable',
			cause: error,
		})
		expect(command).toHaveBeenCalledTimes(1)
	})

	it.each(STATUSES)(
		'returns an exhausted HTTP %s read to the existing bounded stage retry',
		async (status) => {
			vi.spyOn(git_gh_exec, 'exec_gh_command').mockRejectedValue(failure(status))
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
