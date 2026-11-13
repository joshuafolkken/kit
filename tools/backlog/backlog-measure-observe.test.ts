import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { gh_failure } from '#scripts/gh/git-gh-failure'
import { afterEach, expect, test, vi } from 'vitest'
import { backlog_measure_observe } from './backlog-measure-observe'
import type { MeasureBoundary } from './backlog-measure-schema'

const HTTP_FORBIDDEN = 403
const ENDPOINT = 'search/issues'

afterEach(() => vi.restoreAllMocks())

test('persists only observed HTTP status without the secret-bearing response or error', async () => {
	const error = gh_failure.attach(new Error('private credential and response'), {
		status: HTTP_FORBIDDEN,
	})

	vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(error)
	const records: Array<MeasureBoundary> = []
	const restore = backlog_measure_observe.install_http(records, [ENDPOINT])

	try {
		await expect(git_gh_exec.exec_gh_api({ path: ENDPOINT })).rejects.toThrow(
			'Measurement API request failed',
		)
		expect(records).toEqual([
			{
				attempt: '',
				source: 'live',
				operation: 'gh.api',
				read_status: 'failed',
				failure: 'http',
				http_status: HTTP_FORBIDDEN,
				endpoint_index: 0,
				response_reason: 'unreported',
			},
		])
		expect(JSON.stringify(records)).not.toContain('private')
	} finally {
		restore()
	}
})

test('does not infer an HTTP status or rate limit when none was reported', () => {
	expect(backlog_measure_observe.failure(new Error('network failed'))).toEqual({
		failure: 'unreported',
		response_reason: 'unreported',
	})
})

test('keeps an explicitly reported rate-limit reason without the account details', () => {
	const cause = Object.assign(new Error('private'), {
		stdout: JSON.stringify({
			message: 'API rate limit exceeded for private account',
			status: '403',
		}),
	})
	const error = gh_failure.attach(new Error('private', { cause }), { status: HTTP_FORBIDDEN })

	expect(backlog_measure_observe.failure(error)).toEqual({
		failure: 'http',
		http_status: HTTP_FORBIDDEN,
		response_reason: 'API rate limit exceeded',
	})
})

test('observes capped and missing reads and restores methods without altering sync helpers', async () => {
	const owner = {
		measure_window: async function read(): Promise<unknown> {
			return { is_capped: true }
		},
		helper: function helper(): number {
			return 1
		},
	}
	const original = owner.measure_window
	const records: Array<MeasureBoundary> = []
	const restore = backlog_measure_observe.install_reads(new Map([['defect', owner]]), records)

	try {
		expect(await owner.measure_window()).toEqual({ is_capped: true })
		expect(owner.helper()).toBe(1)
		expect(records).toContainEqual(expect.objectContaining({ read_status: 'capped' }))
	} finally {
		restore()
	}

	expect(owner.measure_window).toBe(original)
})
