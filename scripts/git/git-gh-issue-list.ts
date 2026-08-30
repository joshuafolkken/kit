import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { read_blocked_by } from './git-gh-issue-read'
import {
	BLOCKED_BY_FIELD,
	git_gh_issue_rest,
	type BlockedBy,
	type RestIssue,
} from './git-gh-issue-rest'

// Listing open issues through REST, in the JSON shape `gh issue list --json <fields>` answered with.
//
// `gh issue list` goes through GraphQL, which a cloud session is answered 403 for; the REST listing
// is served normally (joshuafolkken/kit#1022). The six callers differ only in filter and fields, so
// the request, the paging and the mapping are decided once here and every caller downstream keeps
// reading the field names it already reads (joshuafolkken/kit#1025).
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
const LISTING_QUERY = 'state=open&sort=created&direction=desc'

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
}

function listing_path(request: IssueListRequest, page: number): string {
	const label = request.label === undefined ? '' : `&labels=${encodeURIComponent(request.label)}`
	const paging = `&per_page=${String(PER_PAGE)}&page=${String(page)}`

	return `${git_gh_api_path.issues_api_path(request.repo)}?${LISTING_QUERY}${label}${paging}`
}

// `--search "<term> in:body"` matched tokens, so `#858` never matched inside `#8580`. A bare
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

// One page, already filtered. `is_full` rides along because the page's *unfiltered* size is what
// says whether there is another page — a page emptied by the filter is still a full page.
async function fetch_page(
	request: IssueListRequest,
	page: number,
): Promise<{ selected: Array<RestIssue>; is_full: boolean }> {
	const path = listing_path(request, page)
	const rows = git_gh_issue_rest.parse_rest_issues(await git_gh_exec.exec_gh_api({ path }))

	return {
		selected: rows.filter((row) => is_selected(row, request)),
		is_full: rows.length >= PER_PAGE,
	}
}

// The ceiling on how far the *body search* pages. Without it that request pages until the backlog
// runs out, every time: its matches are normally zero, so "stop once `limit` rows are selected"
// never fires and the whole open backlog is read, bodies included (joshuafolkken/kit#1033).
//
// Five pages bounds it at five requests, and an `epic:audit` orphan is normally an issue filed
// minutes ago — well inside the newest five hundred. A repository big enough to reach the ceiling is
// *told* rather than handed a shorter answer: a cap applied silently turns "I did not look at
// everything" into "there is nothing there", which is the defect this bound would otherwise
// introduce.
const MAX_PAGES = 5
// The ceiling in issues, which is how the caller that reports the gap phrases it.
const MAX_SCANNED = MAX_PAGES * PER_PAGE
const UNBOUNDED_PAGES = Infinity

// **Only the body search is bounded**, and that is not a detail of where the cost happens to be.
// `is_capped` is answered to one caller and discarded by `issue_list_open`, so a ceiling on a
// listing whose caller cannot read the flag would silently shorten that listing's answer — this
// change's own defect, introduced by the fix for it.
//
// The other five stop at `limit`, which the endpoint's own filters get them to in
// `ceil(limit / PER_PAGE)` pages plus whatever the client-side pull-request exclusion discards. That
// overshoot is unbounded in a repository with hundreds of open pull requests, and it is left exactly
// as it was: bounding it means reporting it, which means the flag reaching six callers and two
// commands' output — a separate deliverable from this one.
function page_ceiling(request: IssueListRequest): number {
	return request.body_term === undefined ? UNBOUNDED_PAGES : MAX_PAGES
}

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
interface SelectedRows {
	rows: Array<RestIssue>
	is_capped: boolean
}

// Paged with `page` rather than `gh api --paginate`, which reads the whole backlog whatever the
// caller asked for: this stops as soon as `limit` rows have been *selected*, so a filter that
// discards most of a page keeps paging exactly as `gh issue list --limit` did, and a listing that
// fits in one page still costs one request.
//
// A short page is the end of the listing, which is what terminates the loop when there are fewer
// than `limit` matches; the page ceiling is what terminates the body search when there are not.
async function fetch_selected(request: IssueListRequest): Promise<SelectedRows> {
	const selected: Array<RestIssue> = []
	const ceiling = page_ceiling(request)
	let page = FIRST_PAGE
	let has_more = true

	while (page <= ceiling && wants_more(has_more, selected.length, request.limit)) {
		const result = await fetch_page(request, page)

		selected.push(...result.selected)
		has_more = result.is_full
		page += 1
	}

	return {
		rows: selected.slice(0, request.limit),
		is_capped: wants_more(has_more, selected.length, request.limit),
	}
}

// `blockedBy` is not in a listing response — GraphQL selected it as a connection, REST serves it from
// each issue's own dependencies endpoint. `read_blocked_by` is the single-issue read's, unchanged:
// it consults the row's `issue_dependencies_summary` first, and every listing row carries one, so an
// issue GitHub itself reports as unblocked costs no request. A backlog with no declared blockers
// therefore costs exactly what `gh` cost — one listing — rather than one request per row.
//
// Sequential rather than a burst: the only caller that asks for the field is the `auto-ok` pickup,
// whose listing is already narrowed by a label, and a rate limit reached in parallel would fail rows
// that a paced pass reads.
async function read_relations(
	rows: ReadonlyArray<RestIssue>,
	repo?: string,
): Promise<Array<BlockedBy>> {
	const relations: Array<BlockedBy> = []

	for (const row of rows) {
		relations.push(await read_blocked_by(String(row.number), row, repo))
	}

	return relations
}

// The listing, plus what it could not cover. `json` is `undefined` — never `'[]'` — when the listing
// could not be read: `epic:next`'s per-repository exclusion reads this answer, and "nothing is
// running" is what *starts* a second run in the same checkout (joshuafolkken/kit#925).
//
// `is_capped` is `false` on that failure path, and says nothing there: an unreadable listing is
// already fully described by `json`, and a caller reading a truncation flag off it would be reading
// a field about pages that were never fetched.
interface IssueListOutcome {
	json: string | undefined
	is_capped: boolean
}

// One invocation shape for every open-issue listing.
async function issue_list_open_outcome(request: IssueListRequest): Promise<IssueListOutcome> {
	try {
		const { rows, is_capped } = await fetch_selected(request)
		const fields = git_gh_issue_rest.split_fields(request.json_fields)
		const relations = fields.includes(BLOCKED_BY_FIELD)
			? await read_relations(rows, request.repo)
			: undefined
		const mapped = rows.map((row, index) =>
			git_gh_issue_rest.to_gh_issue(row, fields, relations?.[index]),
		)

		return { json: JSON.stringify(mapped), is_capped }
	} catch {
		return { json: undefined, is_capped: false }
	}
}

// The same listing for the five callers that cannot reach the page ceiling — every one of them asks
// for a `limit` well under `MAX_SCANNED` with a filter the endpoint itself applies, so there is no
// truncation for them to report and their contract is unchanged (joshuafolkken/kit#1033).
async function issue_list_open(request: IssueListRequest): Promise<string | undefined> {
	const outcome = await issue_list_open_outcome(request)

	return outcome.json
}

const git_gh_issue_list = {
	issue_list_open,
	issue_list_open_outcome,
}

export type { IssueListOutcome, IssueListRequest }
export { git_gh_issue_list, MAX_PAGES, MAX_SCANNED, PER_PAGE }
