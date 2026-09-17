import { describe, expect, it } from 'vitest'
import { gh_reachability } from './git-gh-reachability'

// The line this module draws is the one joshuafolkken/kit#1663 filed: a failure worth asking again
// about, against one that answers the same however often it is asked.
//
// joshuafolkken/kit#1690 removed the probe that used to ask it of a second request; the status now
// comes from the failed request itself, so what is left to pin is the classification.

const OK_STATUS = 200
const NOT_FOUND_STATUS = 404
const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403
const RATE_LIMITED_STATUS = 429
const SERVER_ERROR_STATUS = 500
const GATEWAY_ERROR_STATUS = 503

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

describe('the follow-up probe is gone', () => {
	it('exposes no probe, so nothing can classify a failure from a later request', () => {
		expect('probe' in gh_reachability).toBe(false)
	})
})
