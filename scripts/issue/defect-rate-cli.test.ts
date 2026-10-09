import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { defect_rate_cli } from './defect-rate-cli'

const REPO = 'owner/repo'
const NOW_MS = Date.parse('2026-09-23T14:00:00Z')
const DEFECT_BODY = '- 種別: 不具合'
const INTERRUPT_LABELS = [{ name: 'route:interrupt' }]
const DEFECT_ITEM = { body: DEFECT_BODY, labels: [] }
const ENHANCEMENT_ITEM = { body: '', labels: [{ name: 'enhancement' }] }
const LOWER_BOUNDS = 'lower bounds'
const TWO_SEARCHES = 2
const THREE_PAGES_TOTAL = 201
const OVER_CEILING = 5000
const CEILING_PAGES = 10

// `body` is optional because GitHub serves an empty body as null, which JSON.stringify cannot write
// from a fixture without a null literal — an omitted field reaches the same schema branch.
interface Item {
	body?: string
	labels: ReadonlyArray<{ name: string }>
}

function page(items: ReadonlyArray<Item>, total_count: number = items.length): object {
	return { total_count, incomplete_results: false, items }
}

// The page a request names, 1 when it names none — what GitHub does for `search/issues`.
function page_number(path: string): number {
	return Number(new URLSearchParams(path.split('?', 2)[1]).get('page') ?? '1')
}

// Each search answers its pages by number; a page past the list is a request the code should not
// have made, and is answered with a body no schema accepts.
function stub_search(
	filed: object | ReadonlyArray<object>,
	completed: object | ReadonlyArray<object>,
): MockInstance {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)

	return vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (request: GhApiRequest) => {
		const search = request.path.includes('created') ? filed : completed
		const pages = Array.isArray(search) ? search : [search]

		return JSON.stringify(pages[page_number(request.path) - 1] ?? 'no such page')
	})
}

function requested_pages(api: MockInstance, kind: string): Array<number> {
	return api.mock.calls
		.map((call) => (call[0] as GhApiRequest).path)
		.filter((path) => path.includes(kind))
		.map((path) => page_number(path))
		.toSorted((left, right) => left - right)
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

	it('names a later page', () => {
		expect(defect_rate_cli.search_path('repo:o/r', 3)).toBe(
			'search/issues?q=repo%3Ao%2Fr&per_page=100&page=3',
		)
	})
})

describe('defect_rate_cli.run', () => {
	it('prints the rate from both searches over the requested window', async () => {
		const filed = page([DEFECT_ITEM, { labels: INTERRUPT_LABELS }])
		const api = stub_search(filed, page([ENHANCEMENT_ITEM, ENHANCEMENT_ITEM]))
		const output = capture()

		expect(await defect_rate_cli.run(['--days', '7'], NOW_MS)).toBe(0)
		expect(printed(output)).toContain('last 7 days (since 2026-09-16): 1.00 (2 / 2)')
		expect(api).toHaveBeenCalledTimes(TWO_SEARCHES)
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

// joshuafolkken/kit#3103: the pages are fetched together rather than walked one `next` link at a
// time, so the rate must still count every item on every page, and only the pages that exist.
describe('defect_rate_cli.run — the search pages', () => {
	it('reads every page the first page counts and measures them all', async () => {
		const filed = [
			page([DEFECT_ITEM], THREE_PAGES_TOTAL),
			page([DEFECT_ITEM]),
			page([{ labels: INTERRUPT_LABELS }]),
		]
		const api = stub_search(filed, page([ENHANCEMENT_ITEM, ENHANCEMENT_ITEM, ENHANCEMENT_ITEM]))
		const output = capture()

		expect(await defect_rate_cli.run(['--days', '7'], NOW_MS)).toBe(0)
		expect(requested_pages(api, 'created')).toEqual([1, 2, 3])
		expect(printed(output)).toContain('1.00 (3 / 3)')
	})

	it('reads no page past the search ceiling and warns that the window is capped', async () => {
		const filed = Array.from({ length: CEILING_PAGES }, () => page([DEFECT_ITEM], OVER_CEILING))
		const api = stub_search(filed, page([ENHANCEMENT_ITEM]))
		const output = capture()

		expect(await defect_rate_cli.run([], NOW_MS)).toBe(0)
		expect(requested_pages(api, 'created')).toHaveLength(CEILING_PAGES)
		expect(printed(output)).toContain(LOWER_BOUNDS)
	})

	it('fails rather than measuring part of a search when a later page cannot be read', async () => {
		stub_search(
			[page([DEFECT_ITEM], THREE_PAGES_TOTAL), page([DEFECT_ITEM])],
			page([ENHANCEMENT_ITEM]),
		)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await defect_rate_cli.run([], NOW_MS)).toBe(1)
	})
})
