import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json } from '#scripts/git/parse-json-array'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'

// Every issue one `search/issues` query matches, read page by page. `defect:rate`'s windows and
// `effect:audit`'s listing ask it.

const PER_PAGE = '100'
const FIRST_PAGE = 1
const SECOND_PAGE = 2
// The search API serves at most this many results, so a window past it holds no further page.
const SEARCH_RESULT_CEILING = 1000
// The search API allows 30 requests a minute, so this bounds only how many are in flight at once.
// Kept below the `gh` layer's shared spawn limit (`GH_SPAWN_CONCURRENCY`, `git-gh-exec.ts`), which
// is sized for the core REST budget: the search endpoint's own budget is the narrower one, so a
// search does not spend it in one burst while other `gh` reads hold the remaining slots.
const PAGE_CONCURRENCY = 4
const WINDOW_READ_LIMIT = 15
const MS_PER_SECOND = 1000
const MS_PER_DAY = 86_400_000
const SPLIT_DIVISOR = 2

interface SearchWindow {
	query: string
	qualifier: string
	start: number
	end: number
	is_open: boolean
}

type WindowReader = (
	window: SearchWindow,
	budget: { remaining: number },
) => Promise<SearchResult | undefined>

function skips_pages(first: SearchPage, should_split: boolean): boolean {
	return should_split && first.total_count > SEARCH_RESULT_CEILING
}

const search_item_schema = z.object({
	number: z.number().optional(),
	title: z.string().optional(),
	state: z.string().optional(),
	body: z.string().nullish(),
	labels: z.array(issue_label_schema),
})

// One page of `search/issues`.
const search_page_schema = z.object({
	total_count: z.number(),
	incomplete_results: z.boolean(),
	items: z.array(search_item_schema),
})

type SearchPage = z.infer<typeof search_page_schema>

interface SearchIssue {
	number: number
	title: string
	state: string
	body: string
	labels: ReadonlyArray<string>
}

interface SearchResult {
	issues: ReadonlyArray<SearchIssue>
	is_capped: boolean
}

function search_path(query: string, page: number = FIRST_PAGE): string {
	const parameters = new URLSearchParams({ q: query, per_page: PER_PAGE })

	if (page !== FIRST_PAGE) parameters.set('page', String(page))

	return `search/issues?${parameters.toString()}`
}

// How many pages the search holds, read off the first page's own count. Bounded by the API's
// ceiling, past which GitHub serves no page at all — so this asks for exactly the pages `gh api
// --paginate` would walk to.
function page_count(first: SearchPage): number {
	return Math.ceil(Math.min(first.total_count, SEARCH_RESULT_CEILING) / Number(PER_PAGE))
}

async function read_page(query: string, page: number): Promise<SearchPage | undefined> {
	const raw = await git_gh_exec.exec_gh_api({ path: search_path(query, page) })

	return parse_json.parse_json_object_or_undefined(raw, search_page_schema)
}

// Every page of one search. Not `gh api --paginate`: it follows each page's `next` link one page
// after another, at about 1.5 s a page. The first page names the total, so the rest are fetched
// together; any page that does not read fails the whole search.
async function read_pages(
	query: string,
	should_split = false,
): Promise<ReadonlyArray<SearchPage> | undefined> {
	const first = await read_page(query, FIRST_PAGE)

	if (first === undefined) return undefined
	if (skips_pages(first, should_split)) return [first]

	const rest_numbers = Array.from(
		{ length: Math.max(page_count(first) - FIRST_PAGE, 0) },
		(_value, index) => index + SECOND_PAGE,
	)
	const rest = await bounded_pool.bounded_map(
		rest_numbers,
		PAGE_CONCURRENCY,
		async (page) => await read_page(query, page),
	)

	return rest.every((page) => page !== undefined) ? [first, ...rest] : undefined
}

function to_issue(item: z.infer<typeof search_item_schema>): SearchIssue {
	return {
		number: item.number ?? 0,
		title: item.title ?? '',
		state: item.state ?? '',
		body: item.body ?? '',
		labels: item.labels.map((label) => label.name),
	}
}

function to_result(pages: ReadonlyArray<SearchPage>): SearchResult {
	const issues = pages.flatMap((page) => page.items.map((item) => to_issue(item)))
	// The search API serves at most 1000 results, and says so only by a total larger than what it
	// handed back — a window past that ceiling is measured on part of itself.
	const total = pages[0]?.total_count ?? 0
	const is_incomplete = pages.some((page) => page.incomplete_results)
	const numbers = issues.map((issue) => issue.number).filter((number) => number > 0)
	const has_duplicates = new Set(numbers).size !== numbers.length

	return { issues, is_capped: is_incomplete || total !== issues.length || has_duplicates }
}

function window_query(window: SearchWindow): string {
	const original_start = Date.parse(window.qualifier.split('>=').at(-1) ?? '')

	if (window.is_open && window.start === original_start) return window.query

	const start = new Date(window.start).toISOString().replace('.000Z', 'Z')
	const end = new Date(window.end - MS_PER_SECOND).toISOString().replace('.000Z', 'Z')
	const range = window.is_open ? `>=${start}` : `${start}..${end}`

	return window.query.replace(
		window.qualifier,
		() => `${window.qualifier.split(':', 1)[0] ?? ''}:${range}`,
	)
}

function merge_windows(results: ReadonlyArray<SearchResult>, total: number): SearchResult {
	const issues = results.flatMap((result) => result.issues)
	const unique = new Map(issues.map((issue) => [issue.number, issue]))
	const is_capped =
		results.some((result) => result.is_capped) ||
		unique.size !== total ||
		unique.size !== issues.length

	return { issues: [...unique.values()], is_capped }
}

async function split_window(
	window: SearchWindow,
	budget: { remaining: number },
	total: number,
	read: WindowReader,
): Promise<SearchResult | undefined> {
	const middle =
		Math.floor((window.start + window.end) / SPLIT_DIVISOR / MS_PER_SECOND) * MS_PER_SECOND
	const left = await read({ ...window, end: middle, is_open: false }, budget)

	if (left === undefined) return undefined

	const right = await read({ ...window, start: middle }, budget)

	return right === undefined ? undefined : merge_windows([left, right], total)
}

function can_split(first: SearchPage, window: SearchWindow): boolean {
	return (
		!first.incomplete_results &&
		first.total_count > SEARCH_RESULT_CEILING &&
		window.end - window.start > MS_PER_SECOND
	)
}

async function read_window(
	window: SearchWindow,
	budget: { remaining: number },
): Promise<SearchResult | undefined> {
	if (budget.remaining === 0) return { issues: [], is_capped: true }

	budget.remaining -= 1
	const pages = await read_pages(window_query(window), true)

	if (pages === undefined) return undefined

	const result = to_result(pages)
	const [first] = pages

	if (first === undefined || !can_split(first, window)) return result

	return await split_window(window, budget, first.total_count, read_window)
}

// The search's issues, or `undefined` when any page could not be read.
async function search(query: string): Promise<SearchResult | undefined> {
	try {
		const pages = await read_pages(query)

		return pages === undefined ? undefined : to_result(pages)
	} catch {
		return undefined
	}
}

// The final interval stays open: the partition's union is the original lower-bounded query,
// including timestamps ahead of this process. Never retry an incomplete or failed response.
function rate_qualifier(query: string): string | undefined {
	return /\b(?:created|closed):>=\d{4}-\d{2}-\d{2}\b/u.exec(query)?.[0]
}

async function search_complete(
	query: string,
	now_ms: number = Date.now(),
): Promise<SearchResult | undefined> {
	const qualifier = rate_qualifier(query)

	if (qualifier === undefined) return await search(query)

	const start = Date.parse(qualifier.split('>=').at(-1) ?? '')
	const now = (Math.floor(now_ms / MS_PER_DAY) + 1) * MS_PER_DAY
	const end = Math.max(now, start + MS_PER_SECOND)

	try {
		return await read_window(
			{ query, qualifier, start, end, is_open: true },
			{ remaining: WINDOW_READ_LIMIT },
		)
	} catch {
		return undefined
	}
}

const issue_search = { search, search_complete, search_path }

export type { SearchIssue, SearchResult }
export { issue_search }
