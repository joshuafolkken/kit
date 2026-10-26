import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_search } from './issue-search'

const ISSUE_NUMBER = 4958

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_search.search_path', () => {
	it('encodes the query for the search endpoint', () => {
		expect(issue_search.search_path('repo:o/r created:>=2026-09-09')).toBe(
			'search/issues?q=repo%3Ao%2Fr+created%3A%3E%3D2026-09-09&per_page=100',
		)
	})

	it('names a later page', () => {
		expect(issue_search.search_path('repo:o/r', 3)).toBe(
			'search/issues?q=repo%3Ao%2Fr&per_page=100&page=3',
		)
	})
})

describe('issue_search.search', () => {
	it('reads each issue with its number, title, state, body and label names', async () => {
		const item = {
			number: ISSUE_NUMBER,
			title: 'A title',
			state: 'closed',
			body: 'text',
			labels: [{ name: 'measured' }],
		}

		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(
			JSON.stringify({ total_count: 1, incomplete_results: false, items: [item] }),
		)

		expect(await issue_search.search('repo:o/r')).toEqual({
			issues: [{ ...item, labels: ['measured'] }],
			is_capped: false,
		})
	})

	it('answers nothing when the search cannot be read', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('rate limited'))

		expect(await issue_search.search('repo:o/r')).toBeUndefined()
	})
})
