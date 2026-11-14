import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defect_rate } from './defect-rate'
import { issue_search } from './issue-search'

const START = '2026-11-01'
const NOW = '2026-11-12T12:00:00Z'
const MIDDLE = '2026-11-07T00:00:00.000Z'
const QUERY = defect_rate.filed_query('o/r', START)
const POPULATION = 1101
const PAGE_SIZE = 100
const DEFECT_COUNT = 881
const BEFORE_MIDDLE = '2026-11-06T23:59:59.000Z'
const AFTER_MIDDLE = '2026-11-07T00:00:01.000Z'

interface Item {
	number: number
	created_at: string
	body: string
	labels: Array<{ name: string }>
}

function item(index: number): Item {
	const bodies = ['- 種別: 不具合', 'Mention: - 種別: 不具合', '', '', '']
	const labels = ['', '', 'bug', 'bugfix', 'route:interrupt']
	const kinds = bodies.length

	return {
		number: index + 1,
		created_at: index % 2 === 0 ? BEFORE_MIDDLE : AFTER_MIDDLE,
		body: bodies[index % kinds] ?? '',
		labels: labels[index % kinds] === '' ? [] : [{ name: labels[index % kinds] ?? '' }],
	}
}

function within_range(range: string, timestamp: number): boolean {
	const [start, end] = range.split('..').map((date) => Date.parse(date))

	return timestamp >= (start ?? Infinity) && timestamp <= (end ?? -Infinity)
}

function matches(query: string, value: Item): boolean {
	const range = /(?:created|closed):([^ ]+)/u.exec(query)?.[1] ?? ''
	const timestamp = Date.parse(value.created_at)

	return range.startsWith('>=')
		? timestamp >= Date.parse(range.slice(2))
		: within_range(range, timestamp)
}

function response(request: GhApiRequest, items: ReadonlyArray<Item>): string {
	const parameters = new URLSearchParams(request.path.split('?', 2)[1])
	const selected = items.filter((value) => matches(parameters.get('q') ?? '', value))
	const page = Number(parameters.get('page') ?? '1')
	const offset = (page - 1) * PAGE_SIZE

	return JSON.stringify({
		total_count: selected.length,
		incomplete_results: false,
		items: selected.slice(offset, offset + PAGE_SIZE),
	})
}

function stub(items: ReadonlyArray<Item>): ReturnType<typeof vi.spyOn> {
	return vi
		.spyOn(git_gh_exec, 'exec_gh_api')
		.mockImplementation(async (request) => response(request, items))
}

beforeEach(() => {
	vi.spyOn(Date, 'now').mockReturnValue(Date.parse(NOW))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_search.search_complete', () => {
	it('reads more than 1000 issues without changing the population or body classification', async () => {
		const items = Array.from({ length: POPULATION }, (_value, index) => item(index))
		const api = stub(items)
		const result = await issue_search.search_complete(QUERY)

		expect(result?.is_capped).toBe(false)
		expect(
			result?.issues.map((value) => value.number).toSorted((left, right) => left - right),
		).toEqual(items.map((value) => value.number).toSorted((left, right) => left - right))
		expect(result?.issues.filter((value) => defect_rate.is_defect(value))).toHaveLength(
			DEFECT_COUNT,
		)
		expect(api).toHaveBeenCalledTimes(13)
		expect(api).toHaveBeenNthCalledWith(1, { path: issue_search.search_path(QUERY) })
	})
})

describe('issue_search.search_complete boundaries', () => {
	it.each(['created', 'closed'])(
		'preserves second boundaries and the open upper interval for %s',
		async (field) => {
			const items = Array.from({ length: POPULATION }, (_value, index) => item(index))
			const boundaries = [START, BEFORE_MIDDLE, MIDDLE, AFTER_MIDDLE, NOW, '2027-01-01']

			for (const [index, date] of boundaries.entries()) {
				items[index] = { ...item(index), created_at: date }
			}

			items.push({ ...item(POPULATION), created_at: '2026-10-31T23:59:59Z' })

			stub(items)
			const query = field === 'created' ? QUERY : defect_rate.completed_query('o/r', START)
			const result = await issue_search.search_complete(query)

			expect(result?.is_capped).toBe(false)
			expect(new Set(result?.issues.map((value) => value.number)).size).toBe(POPULATION)
		},
	)
})

describe('issue_search.search_complete completeness', () => {
	it('flags duplicate identities instead of accepting the page count', async () => {
		stub([item(0), item(0)])

		expect(await issue_search.search_complete(QUERY)).toMatchObject({ is_capped: true })
	})

	it('flags duplicate identities across partitions', async () => {
		const items = Array.from({ length: POPULATION }, (_value, index) => item(index))

		items[1] = { ...item(0), created_at: AFTER_MIDDLE }
		stub(items)

		expect(await issue_search.search_complete(QUERY)).toMatchObject({ is_capped: true })
	})

	it('does not split an incomplete response into an apparently complete result', async () => {
		const api = vi
			.spyOn(git_gh_exec, 'exec_gh_api')
			.mockResolvedValue(
				JSON.stringify({ total_count: POPULATION, incomplete_results: true, items: [] }),
			)

		expect(await issue_search.search_complete(QUERY)).toMatchObject({ is_capped: true })
		expect(api).toHaveBeenCalledTimes(1)
	})
})

describe('issue_search.search_complete failures', () => {
	it('returns no population when a partition fails with HTTP 403', async () => {
		const items = Array.from({ length: POPULATION }, (_value, index) => item(index))
		const api = stub(items)

		api.mockRejectedValueOnce(new Error('HTTP 403'))
		expect(await issue_search.search_complete(QUERY)).toBeUndefined()
	})
})

describe('issue_search.search_complete limits', () => {
	it('returns no population when a later partition page fails', async () => {
		const items = Array.from({ length: POPULATION }, (_value, index) => item(index))

		vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (request) => {
			if (request.path.includes('page=2')) throw new Error('HTTP 403')

			return response(request, items)
		})
		expect(await issue_search.search_complete(QUERY)).toBeUndefined()
	})

	it('bounds repeated capped partitions without retries or a successful partial result', async () => {
		const api = vi
			.spyOn(git_gh_exec, 'exec_gh_api')
			.mockResolvedValue(
				JSON.stringify({ total_count: POPULATION, incomplete_results: false, items: [] }),
			)

		expect(await issue_search.search_complete(QUERY)).toMatchObject({ is_capped: true })
		expect(api).toHaveBeenCalledTimes(15)
	})

	it('keeps a population capped at the final second when the clock is behind the query', async () => {
		const api = vi
			.spyOn(git_gh_exec, 'exec_gh_api')
			.mockResolvedValue(
				JSON.stringify({ total_count: POPULATION, incomplete_results: false, items: [] }),
			)

		expect(await issue_search.search_complete(QUERY, Date.parse('2026-10-30'))).toMatchObject({
			is_capped: true,
		})
		expect(api).toHaveBeenCalledTimes(1)
	})
})

describe('issue_search.search_complete partial responses', () => {
	it('rejects an incomplete later page', async () => {
		const items = Array.from({ length: POPULATION }, (_value, index) => item(index))

		vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (request) => {
			return request.path.includes('page=2')
				? JSON.stringify({ total_count: PAGE_SIZE, incomplete_results: true, items: [] })
				: response(request, items)
		})
		expect(await issue_search.search_complete(QUERY)).toMatchObject({ is_capped: true })
	})

	it('rejects a population whose count changes while partitions are read', async () => {
		const items = Array.from({ length: POPULATION }, (_value, index) => item(index))
		const api = stub(items)

		api.mockResolvedValueOnce(
			JSON.stringify({ total_count: POPULATION + 1, incomplete_results: false, items: [] }),
		)
		expect(await issue_search.search_complete(QUERY)).toMatchObject({ is_capped: true })
	})
})
