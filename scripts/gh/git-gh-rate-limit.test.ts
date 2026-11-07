import { afterEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_rate_limit } from './git-gh-rate-limit'

// joshuafolkken/kit#6564: an exhausted rate limit was reported as an authentication failure, and a
// lane child stopped on it while a person refreshed a token that was fine.

const AUTH_COMMAND = 'gh auth status'
const RESET_EPOCH = 1_762_400_400
const RESET_ISO = '2025-11-06T03:40:00.000Z'
const RATE_LIMIT_BODY = JSON.stringify({
	message: 'API rate limit exceeded for user ID 1.',
	documentation_url: 'https://docs.github.com/rest/overview/rate-limits-for-the-rest-api',
	status: '403',
})
const RATE_LIMIT_FAILURE = `gh: API rate limit exceeded for user ID 1. (HTTP 403)\n${RATE_LIMIT_BODY}`
const SPENT_HEADERS = `HTTP/2.0 403 Forbidden\nX-Ratelimit-Remaining: 0\nX-Ratelimit-Reset: ${String(RESET_EPOCH)}\n\n{"message":"Forbidden"}`
const AUTH_FAILURE = `gh: Bad credentials (HTTP 401)\n{"message":"Bad credentials","status":"401"}`
const POLICY_FAILURE = `HTTP/2.0 403 Forbidden\nX-Ratelimit-Remaining: 4999\n\n{"message":"Resource not accessible by integration"}`

function answer_reset(epoch: string): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(epoch)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('gh_rate_limit.failure_hint', () => {
	it('reports a 403 that names the rate limit as exhausted, with the core reset time', async () => {
		const read = answer_reset(String(RESET_EPOCH))

		const hint = await gh_rate_limit.failure_hint(RATE_LIMIT_FAILURE)

		expect(hint).toBe(gh_rate_limit.exhausted_message(new Date(RESET_ISO)))
		expect(hint).toContain(`GitHub rate limit exhausted, resets at ${RESET_ISO}`)
		expect(hint).not.toContain(AUTH_COMMAND)
		expect(read).toHaveBeenCalledWith(
			expect.objectContaining({ path: 'rate_limit', jq_filter: '.resources.core.reset' }),
		)
	})

	it('reads the reset off the response headers when a spent limit carried them', async () => {
		const read = answer_reset('0')

		const hint = await gh_rate_limit.failure_hint(SPENT_HEADERS)

		expect(hint).toContain(`resets at ${RESET_ISO}`)
		expect(read).not.toHaveBeenCalled()
	})

	it('says the reset time is unread when the rate_limit read fails too', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('gh: (HTTP 503)'))

		const hint = await gh_rate_limit.failure_hint(RATE_LIMIT_FAILURE)

		expect(hint).toBe(gh_rate_limit.exhausted_message(undefined))
		expect(hint).toContain('GitHub rate limit exhausted, resets at an unread time')
	})

	it('keeps the authentication hint for a 401', async () => {
		const read = answer_reset(String(RESET_EPOCH))

		expect(await gh_rate_limit.failure_hint(AUTH_FAILURE)).toBe(gh_rate_limit.AUTH_HINT)
		expect(gh_rate_limit.AUTH_HINT).toContain(AUTH_COMMAND)
		expect(read).not.toHaveBeenCalled()
	})
})

describe('gh_rate_limit.is_exhausted', () => {
	it.each([
		['a body naming the primary limit', RATE_LIMIT_BODY, true],
		['GraphQL wording', 'API rate limit already exceeded for user ID 1.', true],
		['a secondary limit', 'You have exceeded a secondary rate limit. (HTTP 403)', true],
		[
			'a 429 with a spent remaining header',
			'HTTP/2.0 429 Too Many\nx-ratelimit-remaining: 0',
			true,
		],
		['a 401', AUTH_FAILURE, false],
		['a 403 with limit left', POLICY_FAILURE, false],
		['a spent header on a 404', 'HTTP/2.0 404 Not Found\nx-ratelimit-remaining: 0', false],
	])('classifies %s', (_label, text, expected) => {
		expect(gh_rate_limit.is_exhausted(text)).toBe(expected)
	})
})
