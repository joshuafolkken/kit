import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json } from '#scripts/git/parse-json-array'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'
import { defect_rate, type DefectRate, type RateIssue } from './defect-rate'

const PER_PAGE = '100'
const FIRST_PAGE = 1
const SECOND_PAGE = 2
// The search API serves at most this many results, so a window past it holds no further page.
const SEARCH_RESULT_CEILING = 1000
// The search API allows 30 requests a minute; both searches together stay at the ~10 requests the
// sequential walk made, so this bounds only how many are in flight at once.
const PAGE_CONCURRENCY = 4

const search_item_schema = z.object({
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

interface SearchResult {
	issues: ReadonlyArray<RateIssue>
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
// after another, at about 1.5 s a page, on every `backlog:plan`. The first page names the total, so
// the rest are fetched together; any page that does not read fails the whole search.
async function read_pages(query: string): Promise<ReadonlyArray<SearchPage> | undefined> {
	const first = await read_page(query, FIRST_PAGE)

	if (first === undefined) return undefined

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

function to_result(pages: ReadonlyArray<SearchPage>): SearchResult {
	const issues = pages.flatMap((page) =>
		page.items.map((item) => ({
			body: item.body ?? '',
			labels: item.labels.map((label) => label.name),
		})),
	)
	// The search API serves at most 1000 results, and says so only by a total larger than what it
	// handed back — a window past that ceiling is measured on part of itself.
	const total = pages[0]?.total_count ?? 0
	const is_incomplete = pages.some((page) => page.incomplete_results)

	return { issues, is_capped: is_incomplete || total > issues.length }
}

async function search(query: string): Promise<SearchResult | undefined> {
	try {
		const pages = await read_pages(query)

		return pages === undefined ? undefined : to_result(pages)
	} catch {
		return undefined
	}
}

// The rate over a window, or `undefined` when either search could not be read. `backlog:next` asks it.
async function measure_window(
	repo: string,
	days: number,
	now_ms: number,
): Promise<DefectRate | undefined> {
	const since = defect_rate.window_start(now_ms, days)
	const [filed, completed] = await Promise.all([
		search(defect_rate.filed_query(repo, since)),
		search(defect_rate.completed_query(repo, since)),
	])

	if (filed === undefined || completed === undefined) return undefined

	const is_capped = filed.is_capped || completed.is_capped

	return defect_rate.measure({
		days,
		since,
		filed: filed.issues,
		completed: completed.issues,
		is_capped,
	})
}

const defect_rate_cli = { search_path, measure_window }

export { defect_rate_cli }
