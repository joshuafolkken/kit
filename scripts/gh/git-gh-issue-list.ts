import { bounded_pool } from '#scripts/lib/bounded-pool'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_blocked_by_graphql } from './git-gh-blocked-by-graphql'
import { git_gh_etag_read } from './git-gh-etag-read'
import { git_gh_issue_list_graphql } from './git-gh-issue-list-graphql'
import { read_blocked_by } from './git-gh-issue-read'
import {
	BLOCKED_BY_COUNT_FIELD,
	BLOCKED_BY_FIELD,
	git_gh_issue_rest,
	type BlockedBy,
	type RestIssue,
} from './git-gh-issue-rest'
import { GH_SPAWN_CONCURRENCY } from './git-gh-spawn-width'

// Listing issues through REST, in the JSON shape `gh issue list --json <fields>` answered with.
//
// `gh issue list` goes through GraphQL, which a cloud session is answered 403 for; the REST listing
// is served normally. The callers differ only in filter and fields, so
// the request, the paging and the mapping are decided once here and every caller downstream keeps
// reading the field names it already reads.
//
// Where the transport allows GraphQL, the open listing newest first is asked in one query first
// (`read_graphql`, joshuafolkken/kit#6785); REST answers whatever that query cannot.
//
// `state` is a parameter because the duplicate scan needs the issue that closed an hour ago, and the
// name describes that behavior rather than the open-only listing most callers ask for.
//
// The field mapping itself is `git-gh-issue-rest.ts`, the same one the single-issue read goes
// through: a listing row and a read response are the same object, so a second copy of the state
// casing, the `createdAt` rename and the `blockedBy` shape would be the clone `CLAUDE.md` prohibits.

// The endpoint's own ceiling for one page, and what every request asks for. Sizing the page to
// `limit` instead would multiply the requests exactly where the client-side filters bite: the search
// replacement discards most of a page, so it would page five times to read what one page holds.
const PER_PAGE = 100
const FIRST_PAGE = 1
// `gh issue list` answered newest first, and two callers depend on it: the next-issues display
// re-sorts by `createdAt`, and both capped listings report that the cap dropped the *oldest* rows.
// REST already defaults to this, so it is spelled out to keep the guarantee off a default.
const DEFAULT_STATE = 'open'
const DEFAULT_SORT = 'created'
const LISTING_DIRECTION = 'direction=desc'

// `state` and `sort` are parameters rather than constants because the duplicate scan has to see the
// issue that closed an hour ago: the work most likely to be filed twice is the work that just
// finished, and a listing fixed at `state=open` cannot show it. Ordering a
// closed listing by `created` would rank it by when each issue was *filed*, which says nothing about
// when it closed — so the sort travels with the state rather than being fixed alongside it.
//
// **The defaults are the six original callers' query, character for character.** Nothing on the open
// side changed, which is what keeps the guarantee above off a default in both directions.
type ListingState = 'open' | 'closed'
type ListingSort = 'created' | 'updated'

// `json_fields` is still the `gh --json` spelling, so no call site changed. `body_term` stands in
// for `--search "<term> in:body"`, which has no REST equivalent at all — the search API refuses a
// session bound to its configured repositories — and whose one caller only ever looked for a literal
// `#<epic>` in the body.
interface IssueListRequest {
	json_fields: string
	limit: number
	label?: string
	// `string | undefined` rather than plain optional: `issue_list_by_label_in_repo` forwards its own
	// optional parameter, which `exactOptionalPropertyTypes` will not narrow for it.
	repo?: string | undefined
	body_term?: string
	state?: ListingState
	sort?: ListingSort
}

// What a listing's path is built from: a caller reading a page on its own — the `auto-ok` probe,
// joshuafolkken/kit#7226 — builds the same path the listing reads without a whole request.
type ListingFilter = Pick<IssueListRequest, 'label' | 'repo' | 'sort' | 'state'>

function listing_query(request: ListingFilter): string {
	const state = request.state ?? DEFAULT_STATE
	const sort = request.sort ?? DEFAULT_SORT

	return `state=${state}&sort=${sort}&${LISTING_DIRECTION}`
}

function listing_path(request: ListingFilter, page: number): string {
	const label = request.label === undefined ? '' : `&labels=${encodeURIComponent(request.label)}`
	const paging = `&per_page=${String(PER_PAGE)}&page=${String(page)}`

	return `${git_gh_api_path.issues_api_path(request.repo)}?${listing_query(request)}${label}${paging}`
}

// `--search "<term> in:body"` matches tokens, so `#858` never matches inside `#8580`. A bare
// substring test does, and those false positives fill the caller's `limit` newest-first — crowding
// out an older genuine match, which `epic:audit` would then never report. The term is always
// `#<number>`, whose `#` anchors the left side, so only a trailing digit has to be refused.
const DIGIT_PATTERN = /\d/u

function has_token_occurrence(body: string, term: string): boolean {
	let index = body.indexOf(term)

	while (index !== -1) {
		// `charAt` past the end answers the empty string, which is not a digit — a match at the very
		// end of the body is a match.
		if (!DIGIT_PATTERN.test(body.charAt(index + term.length))) return true
		index = body.indexOf(term, index + 1)
	}

	return false
}

// The client-side half of the search replacement. A body that is absent never matches, which is the
// same direction the search API took: an issue with no body cannot mention the epic.
function matches_body(rest: RestIssue, term: string | undefined): boolean {
	if (term === undefined) return true
	const { body } = rest

	return typeof body === 'string' && has_token_occurrence(body, term)
}

function is_selected(rest: RestIssue, request: IssueListRequest): boolean {
	return !git_gh_issue_rest.is_pull_request(rest) && matches_body(rest, request.body_term)
}

// One page, already filtered, sent with the ETag of the previous process's read of the same page
// (joshuafolkken/kit#6560). `is_full` rides along because the page's *unfiltered* size is what
// says whether there is another page — a page emptied by the filter is still a full page.
// `is_unchanged` is whether GitHub answered the page 304 (joshuafolkken/kit#7306).
async function fetch_page(
	request: IssueListRequest,
	page: number,
): Promise<{ selected: Array<RestIssue>; is_full: boolean; is_unchanged: boolean }> {
	const detail = await git_gh_etag_read.read_detail(listing_path(request, page))
	const rows = git_gh_issue_rest.parse_rest_issues(detail.body)

	return {
		selected: rows.filter((row) => is_selected(row, request)),
		is_full: rows.length >= PER_PAGE,
		is_unchanged: detail.is_unchanged,
	}
}

// The ceiling on how far *any* listing pages. Without it a request pages until the backlog runs
// out: the body search's matches are normally zero, so "stop once `limit` rows are selected" never
// fires for it, and the other five reach `limit` only after the client-side
// pull-request exclusion has discarded whatever the endpoint served alongside the issues — which in
// a repository with hundreds of open pull requests is the whole backlog again.
//
// Five pages bounds every listing at five requests, and five hundred rows is comfortably above what
// each caller asks for: the widest is `epic:bundle`'s two hundred, which the ceiling only cuts short
// once more than three in five of the newest five hundred open items are pull requests. A repository
// big enough to reach it is *told* rather than handed a shorter answer.
//
// **It applies to every listing only because the flag reaches every caller.** Bounding a listing
// whose caller cannot read `is_capped` would shorten that listing's answer in silence — the defect
// the bound exists to prevent. So the two must never be separated: a ceiling is only ever as safe as
// the caller's ability to say it was reached.
const MAX_PAGES = 5
// The ceiling in issues, which is how the callers that report the gap phrase it.
const MAX_SCANNED = MAX_PAGES * PER_PAGE

// Whether the listing has more to give and the caller still has room for it. Used twice on purpose:
// as the loop's continue condition, and — once the ceiling is what stopped the loop — as the answer
// to whether the ceiling cut the listing short.
function wants_more(has_more: boolean, selected_count: number, limit: number): boolean {
	return has_more && selected_count < limit
}

// The rows, and whether the page ceiling stopped the paging before the listing ran out. `is_capped`
// is **not** the ordinary `limit` cap, which a caller detects from the row count it got back: it is
// the case where fewer than `limit` rows came back and there was still backlog left to read.
//
// Exactly `MAX_SCANNED` open items answers `true` though nothing was missed — the last page is full,
// and the empty page that would have proved the listing ended is the one the ceiling refuses to
// fetch. Left as it is: erring toward "I may not have seen everything" is the safe direction here,
// and the alternative spends a request on every capped run to rule out one boundary.
// `is_unchanged` is whether every page read answered 304.
interface SelectedRows {
	rows: Array<RestIssue>
	is_capped: boolean
	is_unchanged: boolean
}

// Paged with `page` rather than `gh api --paginate`, which reads the whole backlog whatever the
// caller asked for: this stops as soon as `limit` rows have been *selected*, so a filter that
// discards most of a page keeps paging exactly as `gh issue list --limit` did, and a listing that
// fits in one page still costs one request.
//
// A short page is the end of the listing, which is what terminates the loop when there are fewer
// than `limit` matches; the page ceiling is what terminates any listing that has not reached either.
async function fetch_selected(request: IssueListRequest): Promise<SelectedRows> {
	const selected: Array<RestIssue> = []
	// One entry per page read, in order — its length is the pages read so far.
	const unchanged: Array<boolean> = []
	let has_more = true

	while (unchanged.length < MAX_PAGES && wants_more(has_more, selected.length, request.limit)) {
		// eslint-disable-next-line no-await-in-loop -- paging stops as soon as enough rows are selected
		const result = await fetch_page(request, FIRST_PAGE + unchanged.length)

		selected.push(...result.selected)
		has_more = result.is_full
		unchanged.push(result.is_unchanged)
	}

	return {
		rows: selected.slice(0, request.limit),
		is_capped: wants_more(has_more, selected.length, request.limit),
		is_unchanged: unchanged.length > 0 && unchanged.every(Boolean),
	}
}

// `blockedBy` is not in a listing response. The rows declaring blockers are read in one GraphQL query
// per hundred (`git-gh-blocked-by-graphql.ts`), so the scan's request count does not grow with them.
// A row that query did not answer goes to `read_blocked_by`, the single-issue read's, unchanged: it
// consults the row's `issue_dependencies_summary` first, so an issue GitHub itself reports as
// unblocked costs no request.
//
// The REST reads are bounded rather than sequential: the pass was paced one request at a time,
// which made every `backlog:plan` wait about 0.7 s per opted-in issue declaring a blocker. The `gh`
// layer's shared spawn limit already bounds the burst; the pool stays because `read_blocked_by`
// throws, and a rate-limited read fails the whole listing — `bounded_map` then starts no further
// read (`bounded-pool.ts`), where a `Promise.all` would have queued every row's read into the same
// rate limit for an answer nobody reads. Its width is the layer's, so the pool adds no bound of its own.
async function read_relations(
	rows: ReadonlyArray<RestIssue>,
	repo?: string,
): Promise<Array<BlockedBy>> {
	const answered = await git_gh_blocked_by_graphql.read_answered(rows)

	return await bounded_pool.bounded_map(
		rows,
		GH_SPAWN_CONCURRENCY,
		async (row) => answered.get(row) ?? (await read_blocked_by(String(row.number), row, repo)),
	)
}

// The listing, plus what it could not cover. `json` is `undefined` — never `'[]'` — when the listing
// could not be read: `epic:next`'s per-repository exclusion reads this answer, and "nothing is
// running" is what *starts* a second run in the same checkout.
//
// `is_capped` is `false` on that failure path, and says nothing there: an unreadable listing is
// already fully described by `json`, and a caller reading a truncation flag off it would be reading
// a field about pages that were never fetched.
//
// `is_unchanged` is `true` only where every REST page answered 304 (joshuafolkken/kit#7306), so
// `backlog:next` can record whether its listing was the previous scan's. A GraphQL read carries no
// ETag and answers `false`; it is absent on the failure path.
interface IssueListOutcome {
	json: string | undefined
	is_capped: boolean
	is_unchanged?: boolean
}

interface MappedListing {
	rows: Array<Record<string, unknown>>
	is_capped: boolean
	is_unchanged: boolean
}

// The fields a GraphQL listing row carries (`git_gh_issue_graphql.to_rest_issue`). A request naming
// any other — `stateReason`, `updatedAt`, `state` — stays on REST, which answers every field.
const GRAPHQL_FIELDS = new Set([
	'number',
	'title',
	'body',
	'labels',
	'createdAt',
	'url',
	'author_association',
	'user',
	BLOCKED_BY_FIELD,
	BLOCKED_BY_COUNT_FIELD,
])

function is_open_newest_first(request: IssueListRequest): boolean {
	return (
		(request.state ?? DEFAULT_STATE) === DEFAULT_STATE &&
		(request.sort ?? DEFAULT_SORT) === DEFAULT_SORT
	)
}

// One GraphQL page answers only the open listing newest first. A limit past one page still asks it:
// a pool that fits the page answers whole, and one that does not reads REST (`read_graphql`).
function is_graphql_listing(request: IssueListRequest, fields: ReadonlyArray<string>): boolean {
	return is_open_newest_first(request) && fields.every((field) => GRAPHQL_FIELDS.has(field))
}

// The listing in one GraphQL query (joshuafolkken/kit#6785), so a `backlog:next` cold scan spends
// no REST core request. `undefined` — a REST session, a failed query, or a page that does not answer
// the caller — hands the listing to REST, whose answer this one matches row for row.
async function read_graphql(
	request: IssueListRequest,
	fields: ReadonlyArray<string>,
): Promise<MappedListing | undefined> {
	if (!is_graphql_listing(request, fields)) return undefined

	const page = await git_gh_issue_list_graphql.read_open_page(request.label, request.repo)
	if (page === undefined) return undefined

	const selected = page.issues.filter((issue) => is_selected(issue.rest, request))
	if (wants_more(page.has_next_page, selected.length, request.limit)) return undefined

	const rows = selected
		.slice(0, request.limit)
		.map((issue) => git_gh_issue_rest.to_gh_issue(issue.rest, fields, issue.blocked_by))

	return { rows, is_capped: false, is_unchanged: false }
}

async function read_rest(
	request: IssueListRequest,
	fields: ReadonlyArray<string>,
): Promise<MappedListing> {
	const { rows, is_capped, is_unchanged } = await fetch_selected(request)
	const relations = fields.includes(BLOCKED_BY_FIELD)
		? await read_relations(rows, request.repo)
		: undefined
	const mapped = rows.map((row, index) =>
		git_gh_issue_rest.to_gh_issue(row, fields, relations?.[index]),
	)

	return { rows: mapped, is_capped, is_unchanged }
}

// One invocation shape for every issue listing.
async function issue_list(request: IssueListRequest): Promise<IssueListOutcome> {
	try {
		const fields = git_gh_issue_rest.split_fields(request.json_fields)
		const { rows, is_capped, is_unchanged } =
			(await read_graphql(request, fields)) ?? (await read_rest(request, fields))

		return { json: JSON.stringify(rows), is_capped, is_unchanged }
	} catch {
		return { json: undefined, is_capped: false }
	}
}

// The flag-discarding second entry point is gone. It answered
// `string | undefined` for the five callers that could not reach the page ceiling, and once the
// ceiling applies to all six there is no such caller left: a wrapper that dropped `is_capped` would
// be the one way back to a silently shortened answer, so it is removed rather than left for someone
// to reach for. Every caller now receives the whole outcome and decides what truncation means for
// it — `git-gh-issue.ts` records that decision, caller by caller.
const git_gh_issue_list = {
	issue_list,
	listing_path,
}

export type { IssueListOutcome, IssueListRequest }
export { FIRST_PAGE, git_gh_issue_list, MAX_PAGES, MAX_SCANNED, PER_PAGE }
