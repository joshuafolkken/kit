import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_search_count } from './issue-search-count'

const QUERY = 'repo:o/r is:issue is:closed reason:completed label:enhancement closed:>=2026-11-06'
const OVER_CEILING = 1501

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_search_count.count', () => {
	it.each([0, 1, OVER_CEILING])(
		'reads an exact count of %i in one request',
		async (total_count) => {
			const api = vi
				.spyOn(git_gh_exec, 'exec_gh_api')
				.mockResolvedValue(JSON.stringify({ total_count, incomplete_results: false }))

			expect(await issue_search_count.count(QUERY)).toBe(total_count)
			expect(api).toHaveBeenCalledExactlyOnceWith({
				path: `search/issues?${new URLSearchParams({ q: QUERY, per_page: '1' }).toString()}`,
			})
		},
	)

	it.each([
		{ total_count: OVER_CEILING, incomplete_results: true },
		{ total_count: -1, incomplete_results: false },
		{ total_count: 0.5, incomplete_results: false },
		{ total_count: '1', incomplete_results: false },
		{ total_count: 1 },
	])('refuses an incomplete or invalid count: %j', async (response) => {
		const api = vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(JSON.stringify(response))

		expect(await issue_search_count.count(QUERY)).toBeUndefined()
		expect(api).toHaveBeenCalledTimes(1)
	})

	it('leaves a rejected API wrapper call unread without calling the wrapper again', async () => {
		const api = vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('unavailable'))

		expect(await issue_search_count.count(QUERY)).toBeUndefined()
		expect(api).toHaveBeenCalledTimes(1)
	})
})
