import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { DefectRate } from './defect-rate'
import { defect_rate_cli } from './defect-rate-cli'

const REPO = 'owner/repo'
const NOW_MS = Date.parse('2026-09-23T14:00:00Z')
const DAYS = 7
const DEFECT_BODY = '- 種別: 不具合'
const INTERRUPT_LABELS = [{ name: 'route:interrupt' }]
const DEFECT_ITEM = { body: DEFECT_BODY, labels: [] }
const ENHANCEMENT_ITEM = { body: '', labels: [{ name: 'enhancement' }] }
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

async function measure(days: number = DAYS): Promise<DefectRate | undefined> {
	return await defect_rate_cli.measure_window(REPO, days, NOW_MS)
}

afterEach(() => {
	vi.restoreAllMocks()
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

describe('defect_rate_cli.measure_window', () => {
	it('measures both searches over the requested window', async () => {
		const filed = page([DEFECT_ITEM, { labels: INTERRUPT_LABELS }])
		const api = stub_search(filed, page([ENHANCEMENT_ITEM, ENHANCEMENT_ITEM]))

		expect(await measure()).toEqual({
			days: DAYS,
			since: '2026-09-16',
			defects: 2,
			enhancements: 2,
			is_capped: false,
		})
		expect(api).toHaveBeenCalledTimes(TWO_SEARCHES)
	})

	it('answers nothing rather than a rate when a search cannot be read', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('rate limited'))

		expect(await measure()).toBeUndefined()
	})
})

// joshuafolkken/kit#3103: the pages are fetched together rather than walked one `next` link at a
// time, so the rate must still count every item on every page, and only the pages that exist.
describe('defect_rate_cli.measure_window — the search pages', () => {
	it('reads every page the first page counts and measures them all', async () => {
		const filed = [
			page([DEFECT_ITEM], THREE_PAGES_TOTAL),
			page([DEFECT_ITEM]),
			page([{ labels: INTERRUPT_LABELS }]),
		]
		const api = stub_search(filed, page([ENHANCEMENT_ITEM, ENHANCEMENT_ITEM, ENHANCEMENT_ITEM]))

		expect(await measure()).toMatchObject({ defects: 3, enhancements: 3 })
		expect(requested_pages(api, 'created')).toEqual([1, 2, 3])
	})

	it('reads no page past the search ceiling and marks the window capped', async () => {
		const filed = Array.from({ length: CEILING_PAGES }, () => page([DEFECT_ITEM], OVER_CEILING))
		const api = stub_search(filed, page([ENHANCEMENT_ITEM]))

		expect(await measure()).toMatchObject({ is_capped: true })
		expect(requested_pages(api, 'created')).toHaveLength(CEILING_PAGES)
	})

	it('answers nothing rather than measuring part of a search when a later page cannot be read', async () => {
		stub_search(
			[page([DEFECT_ITEM], THREE_PAGES_TOTAL), page([DEFECT_ITEM])],
			page([ENHANCEMENT_ITEM]),
		)

		expect(await measure()).toBeUndefined()
	})
})
