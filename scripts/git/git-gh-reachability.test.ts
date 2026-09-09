import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_reachability } from './git-gh-reachability'

// The line this module draws is the one joshuafolkken/kit#1663 filed: a failure worth asking again
// about, against one that answers the same however often it is asked.

const OK_STATUS = 200
const NOT_FOUND_STATUS = 404
const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403
const RATE_LIMITED_STATUS = 429
const SERVER_ERROR_STATUS = 500
const GATEWAY_ERROR_STATUS = 503

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('classify_status', () => {
	it('reads no status line at all as the transport failure it is', () => {
		expect(gh_reachability.classify_status(undefined)).toBe('unreachable')
	})

	it('reads a rate limit and a server error as worth asking again about', () => {
		expect(gh_reachability.classify_status(RATE_LIMITED_STATUS)).toBe('unreachable')
		expect(gh_reachability.classify_status(SERVER_ERROR_STATUS)).toBe('unreachable')
		expect(gh_reachability.classify_status(GATEWAY_ERROR_STATUS)).toBe('unreachable')
	})

	it('reads an answered request as reachable even when the answer was a refusal', () => {
		expect(gh_reachability.classify_status(OK_STATUS)).toBe('reachable')
		expect(gh_reachability.classify_status(NOT_FOUND_STATUS)).toBe('reachable')
		expect(gh_reachability.classify_status(UNAUTHORIZED_STATUS)).toBe('reachable')
	})

	// A permanent authorization failure that GitHub happens to spell 403 keeps the diagnosis that
	// names the credentials, rather than being reported as a connection nobody can fix by waiting.
	it('reads a forbidden answer as reachable rather than as a transport failure', () => {
		expect(gh_reachability.classify_status(FORBIDDEN_STATUS)).toBe('reachable')
	})
})

describe('probe', () => {
	it('asks the endpoint that does not deepen a rate limit and classifies what it answered', async () => {
		const status = vi.spyOn(git_gh_exec, 'exec_gh_api_status').mockResolvedValue(OK_STATUS)

		expect(await gh_reachability.probe()).toBe('reachable')
		expect(status).toHaveBeenCalledWith(gh_reachability.REACHABILITY_PATH)
	})

	it('answers unreachable when the probe itself reached no status', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api_status').mockResolvedValue(undefined)

		expect(await gh_reachability.probe()).toBe('unreachable')
	})
})
