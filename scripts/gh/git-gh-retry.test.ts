import { describe, expect, it, vi } from 'vitest'
import { gh_failure } from './git-gh-failure'
import { gh_retry, type RetryHooks } from './git-gh-retry'

// joshuafolkken/kit#4717: a request GitHub failed transiently — a 5xx, or no answer at all — is asked
// again a bounded number of times, one log line per retry; a 4xx, a timeout and a non-gh error are not.

const { MAX_ATTEMPTS, RETRY_DELAYS_MS, is_transient, with_retry } = gh_retry
const BAD_GATEWAY = 'gh: Server Error (HTTP 502)'
const OK = 'ok'
const SERVER_ERROR_STATUS = 503
const NOT_FOUND_STATUS = 404

function gh_error(message: string, status?: number, cause: unknown = {}): Error {
	return gh_failure.attach(new Error(message, { cause }), { status })
}

function hooks(): RetryHooks & { waits: Array<number>; notes: Array<string> } {
	const waits: Array<number> = []
	const notes: Array<string> = []

	return {
		waits,
		notes,
		wait: async (milliseconds) => {
			waits.push(milliseconds)
		},
		note: (text) => {
			notes.push(text)
		},
	}
}

function failing_then(failures: Array<Error>): () => Promise<string> {
	const queue = [...failures]

	return vi.fn(async () => {
		const failure = queue.shift()

		if (failure !== undefined) throw failure

		return OK
	})
}

describe('gh_retry.with_retry', () => {
	it('succeeds on the retry after a 502, leaving one log line', async () => {
		const request = failing_then([gh_error(BAD_GATEWAY)])
		const recorded = hooks()

		await expect(with_retry(request, recorded)).resolves.toBe(OK)
		expect(request).toHaveBeenCalledTimes(2)
		expect(recorded.waits).toEqual([RETRY_DELAYS_MS[0]])
		expect(recorded.notes).toHaveLength(1)
		expect(recorded.notes[0]).toContain(BAD_GATEWAY)
	})

	it('throws the last failure once every attempt failed, one log line per retry', async () => {
		const last = gh_error(BAD_GATEWAY)
		const request = failing_then([gh_error(BAD_GATEWAY), gh_error(BAD_GATEWAY), last])
		const recorded = hooks()

		await expect(with_retry(request, recorded)).rejects.toBe(last)
		expect(request).toHaveBeenCalledTimes(MAX_ATTEMPTS)
		expect(recorded.waits).toEqual(RETRY_DELAYS_MS)
		expect(recorded.notes).toHaveLength(MAX_ATTEMPTS - 1)
	})

	it('does not retry a 4xx', async () => {
		const not_found = gh_error('gh: Not Found (HTTP 404)', NOT_FOUND_STATUS)
		const request = failing_then([not_found])
		const recorded = hooks()

		await expect(with_retry(request, recorded)).rejects.toBe(not_found)
		expect(request).toHaveBeenCalledTimes(1)
		expect(recorded.notes).toEqual([])
	})
})

describe('gh_retry.is_transient', () => {
	it('reads a 5xx from the error document', () => {
		expect(is_transient(gh_error('gh: failed', SERVER_ERROR_STATUS))).toBe(true)
	})

	it("reads a 5xx from gh's summary line when the body is not GitHub's document", () => {
		expect(is_transient(gh_error(BAD_GATEWAY))).toBe(true)
	})

	it('treats a request that got no answer as a connection error', () => {
		expect(is_transient(gh_error('error connecting to api.github.com'))).toBe(true)
	})

	it('does not retry a 4xx read from the summary line', () => {
		expect(is_transient(gh_error('gh: Validation Failed (HTTP 422)'))).toBe(false)
	})

	it('does not retry a timed-out request', () => {
		expect(is_transient(gh_error('gh request timed out', undefined, { timedOut: true }))).toBe(
			false,
		)
	})

	it('does not retry a request gh refused for want of authentication', () => {
		expect(is_transient(gh_error('gh auth login', undefined, { exitCode: 4 }))).toBe(false)
	})

	it('does not retry an error gh never answered with', () => {
		expect(is_transient(new Error('gh CLI is not installed.'))).toBe(false)
	})
})
