import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_gh_exec, type GhApiRequest } from '#scripts/git/git-gh-exec'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { defect_rate_cli } from './defect-rate-cli'

const REPO = 'owner/repo'
const NOW_MS = Date.parse('2026-09-23T14:00:00Z')
const DEFECT_BODY = '- 種別: 不具合'
const BEHAVIOR_BODY = '- 種別: 振る舞い変更'
const SEARCH_CAP = 1000
const INTERRUPT_LABELS = [{ name: 'route:interrupt' }]
const DEFECT_ITEM = { body: DEFECT_BODY, labels: [] }
const BEHAVIOR_ITEM = { body: BEHAVIOR_BODY, labels: [] }
const LOWER_BOUNDS = 'lower bounds'

// `body` is optional because GitHub serves an empty body as null, which JSON.stringify cannot write
// from a fixture without a null literal — an omitted field reaches the same schema branch.
interface Item {
	body?: string
	labels: ReadonlyArray<{ name: string }>
}

function page(items: ReadonlyArray<Item>, total_count: number = items.length): object {
	return { total_count, incomplete_results: false, items }
}

function stub_search(filed: object, completed: object): MockInstance {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)

	return vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (request: GhApiRequest) => {
		const pages = request.path.includes('created') ? filed : completed

		return JSON.stringify([pages])
	})
}

function capture(): MockInstance {
	return vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

function printed(spy: MockInstance): string {
	return spy.mock.calls.map((call) => String(call[0])).join('\n')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('defect_rate_cli.read_days', () => {
	it('defaults to 14 days', () => {
		expect(defect_rate_cli.read_days([])).toBe(14)
	})

	it('reads a positive whole number of days', () => {
		expect(defect_rate_cli.read_days(['--days', '30'])).toBe(30)
	})

	it('accepts a window of ten years', () => {
		expect(defect_rate_cli.read_days(['--days', '3650'])).toBe(3650)
	})

	it.each([['0'], [''], ['1.5'], ['-3'], ['3651'], ['999999999']])('refuses --days %j', (raw) => {
		expect(defect_rate_cli.read_days(['--days', raw])).toBeUndefined()
	})

	it('refuses an unknown flag', () => {
		expect(defect_rate_cli.read_days(['--day', '3'])).toBeUndefined()
	})
})

describe('defect_rate_cli.search_path', () => {
	it('encodes the query for the search endpoint', () => {
		expect(defect_rate_cli.search_path('repo:o/r created:>=2026-09-09')).toBe(
			'search/issues?q=repo%3Ao%2Fr+created%3A%3E%3D2026-09-09&per_page=100',
		)
	})
})

describe('defect_rate_cli.run', () => {
	it('prints the rate from both searches over the requested window', async () => {
		const filed = page([DEFECT_ITEM, { labels: INTERRUPT_LABELS }])
		const api = stub_search(filed, page([BEHAVIOR_ITEM, BEHAVIOR_ITEM]))
		const output = capture()

		expect(await defect_rate_cli.run(['--days', '7'], NOW_MS)).toBe(0)
		expect(printed(output)).toContain('last 7 days (since 2026-09-16): 1.00 (2 / 2)')
		expect(api).toHaveBeenCalledWith(
			expect.objectContaining({ should_paginate: true, should_slurp: true }),
		)
	})

	it('warns when the search served fewer issues than it found', async () => {
		stub_search(page([DEFECT_ITEM], SEARCH_CAP), page([BEHAVIOR_ITEM]))
		const output = capture()

		expect(await defect_rate_cli.run([], NOW_MS)).toBe(0)
		expect(printed(output)).toContain(LOWER_BOUNDS)
	})

	it('fails rather than printing a rate when a search cannot be read', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('rate limited'))
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await defect_rate_cli.run([], NOW_MS)).toBe(1)
		expect(errors).toHaveBeenCalled()
	})

	it('fails with the usage on an unreadable window', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await defect_rate_cli.run(['--days', 'x'], NOW_MS)).toBe(1)
		expect(errors).toHaveBeenCalledWith(defect_rate_cli.USAGE)
	})
})
