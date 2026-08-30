import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_list, MAX_PAGES, PER_PAGE, type IssueListOutcome } from './git-gh-issue-list'
import {
	BLOCKER_NUMBER,
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
	rest_blockers,
	rest_dependencies_summary,
	rest_issue_page,
	rest_pull_request,
} from './git-gh-issue-rest-fixture'
import { parse_json_array_or_undefined } from './parse-json-array'
import { open_issue_schema, type OpenIssueData } from './schemas'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#1025: `gh issue list` goes through GraphQL, which a cloud session is answered
// 403 for, so every open-issue listing moves to `repos/{owner}/{repo}/issues`. The six callers keep
// the JSON shape `gh issue list --json` answered with, which is what these tests pin.

const SUMMARY_FIELDS = 'number,title,labels,createdAt'
const PICKUP_FIELDS = `${SUMMARY_FIELDS},blockedBy`
const BODY_FIELDS = 'number,body'
const OTHER_REPO = 'joshuafolkken/app-kit'
const CURRENT_REPO_ISSUES = 'repos/{owner}/{repo}/issues'
const BLOCKED_BY_SEGMENT = '/dependencies/blocked_by'
const EMPTY_PAGE = '[]'
const PR_NUMBER = 777
const SECOND_NUMBER = 900
const LIMIT_ONE = 1
const LIMIT_TWO = 2
const LIMIT_MANY = 50
const ONE_REQUEST = 1
const TWO_REQUESTS = 2
const SEARCH_TERM = '#1022'
const FIRST_PAGE_OFFSET = 0

function api_paths(): Array<string> {
	return mocked_api.mock.calls.map(([request]) => request.path)
}

// The listing endpoint answers the pages in order; the dependencies endpoint answers blockers.
function serve(pages: ReadonlyArray<string>, blockers: string = EMPTY_PAGE): void {
	let index = 0

	mocked_api.mockImplementation(async (request) => {
		if (request.path.includes(BLOCKED_BY_SEGMENT)) return blockers

		const page = pages[index] ?? EMPTY_PAGE

		index += 1

		return page
	})
}

// The body search is the one listing the page ceiling applies to, so every case about the ceiling
// goes through it. `SEARCH_TERM` matches nothing the filler rows carry unless a row says so.
async function search_outcome(limit: number): Promise<IssueListOutcome> {
	return await git_gh_issue_list.issue_list_open_outcome({
		json_fields: BODY_FIELDS,
		limit,
		body_term: SEARCH_TERM,
	})
}

async function search_is_capped(limit: number): Promise<boolean> {
	const outcome = await search_outcome(limit)

	return outcome.is_capped
}

// One page at the endpoint's own ceiling, so the paging reads it as "there may be more". Filled with
// pull requests when the client-side filter should empty it, and with issues when it should not.
function full_page_of(page: number, is_filtered_out: boolean): string {
	return rest_issue_page(
		Array.from({ length: PER_PAGE }, (_value, index) =>
			is_filtered_out
				? rest_pull_request(PR_NUMBER + page * PER_PAGE + index)
				: { number: ISSUE_NUMBER + page * PER_PAGE + index, body: SEARCH_TERM },
		),
	)
}

// Through the schema the next-issues display and the `auto-ok` pickup read the listing with, so the
// assertion is typed and the mapped JSON is proven to parse under the shape written for `gh`.
function parse_listing(json: string | undefined): Array<OpenIssueData> | undefined {
	return json === undefined ? undefined : parse_json_array_or_undefined(json, open_issue_schema)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('issue_list_open — the request', () => {
	it('reads the REST listing rather than gh issue list', async () => {
		serve([rest_issue_page([{}])])

		await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY })

		expect(api_paths()[0]).toContain(`${CURRENT_REPO_ISSUES}?state=open`)
	})

	// `gh issue list` answered newest first, and both capped callers report that the cap dropped the
	// oldest rows. Left to REST's default the guarantee would be off a default.
	it('asks for the newest first', async () => {
		serve([rest_issue_page([{}])])

		await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY })

		expect(api_paths()[0]).toContain('sort=created&direction=desc')
	})

	// `--label` becomes the endpoint's own query parameter, so the filter stays the query's job.
	it('sends a label filter as the labels parameter', async () => {
		serve([rest_issue_page([{}])])

		await git_gh_issue_list.issue_list_open({
			json_fields: SUMMARY_FIELDS,
			limit: LIMIT_MANY,
			label: 'auto-ok',
		})

		expect(api_paths()[0]).toContain('&labels=auto-ok')
	})

	// `--repo owner/name` becomes the path prefix — the per-repository read `epic:next` makes before
	// it offers a child.
	it('names another repository in the path', async () => {
		serve([rest_issue_page([{}])])

		await git_gh_issue_list.issue_list_open({
			json_fields: SUMMARY_FIELDS,
			limit: LIMIT_MANY,
			label: 'in-progress',
			repo: OTHER_REPO,
		})

		expect(api_paths()[0]).toContain(`repos/${OTHER_REPO}/issues`)
	})
})

describe('issue_list_open — the answer', () => {
	// The field names are still `gh issue list --json`'s: `createdAt` from `created_at`, and the
	// state upper-cased, which is what every reader downstream compares against.
	it('answers in the field names gh answered in', async () => {
		serve([rest_issue_page([{}])])

		const rows = parse_listing(
			await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY }),
		)

		expect(rows).toEqual([
			{
				number: ISSUE_NUMBER,
				title: ISSUE_TITLE,
				labels: [{ name: ISSUE_LABEL }],
				createdAt: ISSUE_CREATED_AT,
			},
		])
	})

	// REST's `/issues` serves pull requests alongside issues; `gh issue list` never did, and the five
	// callers all read the answer as issues — `epic:bundle` would offer a pull request as a bundle
	// candidate and `epic:busy` would count one as a running child.
	it('drops pull requests from the listing', async () => {
		serve([rest_issue_page([rest_pull_request(PR_NUMBER), {}])])

		const rows = parse_listing(
			await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY }),
		)

		expect(rows?.map((row) => row.number)).toEqual([ISSUE_NUMBER])
	})

	// A page that is short of `per_page` is the end of the listing, so no further page is asked for.
	it('stops at the end of the listing', async () => {
		serve([rest_issue_page([{}])])

		await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY })

		expect(mocked_api).toHaveBeenCalledTimes(ONE_REQUEST)
	})

	// `limit` capped the listing under `gh` and caps it here, so the callers that report "the listing
	// hit its cap" still see exactly `limit` rows.
	it('cuts the listing off at limit', async () => {
		serve([rest_issue_page([{}, { number: SECOND_NUMBER }])])

		const rows = parse_listing(
			await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_ONE }),
		)

		expect(rows?.map((row) => row.number)).toEqual([ISSUE_NUMBER])
	})
})

describe('issue_list_open — the paging', () => {
	// A full page means there may be more, and a filter that discards most of one is why the paging
	// continues rather than answering short — the behavior `gh issue list --limit` had.
	it('reads a further page while the last one was full', async () => {
		const fillers = Array.from({ length: PER_PAGE - LIMIT_ONE }, (_value, index) =>
			rest_pull_request(PR_NUMBER + index),
		)

		serve([rest_issue_page([{}, ...fillers]), rest_issue_page([{ number: SECOND_NUMBER }])])

		const rows = parse_listing(
			await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_TWO }),
		)

		expect(rows?.map((row) => row.number)).toEqual([ISSUE_NUMBER, SECOND_NUMBER])
		expect(mocked_api).toHaveBeenCalledTimes(TWO_REQUESTS)
	})

	// `epic:next`'s per-repository exclusion reads this answer, and "nothing is running" is what
	// *starts* a second run in the same checkout (joshuafolkken/kit#925).
	it('answers undefined rather than an empty listing when the read fails', async () => {
		mocked_api.mockRejectedValue(new Error('HTTP 403'))

		expect(
			await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY }),
		).toBeUndefined()
	})

	// A response that is not a listing — `gh` answering `{"message":"API rate limit exceeded"}` — is
	// the same gap, not an empty backlog.
	it('answers undefined when the response is not a listing', async () => {
		serve(['{"message":"API rate limit exceeded"}'])

		expect(
			await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY }),
		).toBeUndefined()
	})
})

// joshuafolkken/kit#1033: the body search below matches nothing on a normal run, so "stop once
// `limit` rows are selected" never fires and the paging read the whole open backlog every time.
describe('issue_list_open_outcome — the page ceiling', () => {
	// A page the filter empties is still a full page, so the paging continues — which is exactly the
	// shape that has no natural end short of the backlog running out.
	it('stops paging at the ceiling and says the scan was cut short', async () => {
		serve(Array.from({ length: MAX_PAGES + LIMIT_ONE }, (_value, page) => full_page_of(page, true)))

		const outcome = await search_outcome(LIMIT_MANY)

		expect(mocked_api).toHaveBeenCalledTimes(MAX_PAGES)
		expect(outcome.is_capped).toBe(true)
	})

	// The ceiling is answered to one caller and discarded by `issue_list_open`, so putting it on a
	// listing whose caller cannot read the flag would silently shorten that listing's answer — this
	// change's own defect, introduced by the fix for it. The pull-request exclusion is client-side on
	// every listing, so `epic:bundle`'s backlog scan is exactly that case.
	it('leaves a listing with no body search unbounded', async () => {
		const pages = Array.from({ length: MAX_PAGES + LIMIT_ONE }, (_value, page) =>
			full_page_of(page, true),
		)

		serve([...pages, EMPTY_PAGE])

		const outcome = await git_gh_issue_list.issue_list_open_outcome({
			json_fields: BODY_FIELDS,
			limit: LIMIT_MANY,
		})

		expect(mocked_api.mock.calls.length).toBeGreaterThan(MAX_PAGES)
		expect(outcome.is_capped).toBe(false)
	})

	// A cap applied silently turns "I did not look at everything" into "there is nothing there", so a
	// listing that genuinely ran out has to be distinguishable from one that was cut off.
	it('does not call a listing that ran out capped', async () => {
		serve([rest_issue_page([{ body: SEARCH_TERM }])])

		expect(await search_is_capped(LIMIT_MANY)).toBe(false)
	})

	// The ordinary `limit` cap is a different thing, and every caller already detects that one from
	// the row count it got back.
	it('does not call a listing that filled its limit capped', async () => {
		serve([full_page_of(FIRST_PAGE_OFFSET, false)])

		expect(await search_is_capped(LIMIT_MANY)).toBe(false)
	})

	// An unreadable listing is fully described by `json`; a truncation flag on it would be about
	// pages that were never fetched.
	it('answers no json and no cap when the read fails', async () => {
		mocked_api.mockRejectedValue(new Error('HTTP 403'))

		expect(await search_outcome(LIMIT_MANY)).toEqual({ json: undefined, is_capped: false })
	})
})

describe('issue_list_open — the search replacement', () => {
	// `--search "<term> in:body"` went through the search API, which a session bound to its
	// configured repositories is refused. The one caller only ever looked for a literal `#<epic>`.
	it('keeps only the rows whose body carries the term', async () => {
		serve([rest_issue_page([{}, { number: SECOND_NUMBER, body: 'no mention here' }])])

		const json = await git_gh_issue_list.issue_list_open({
			json_fields: BODY_FIELDS,
			limit: LIMIT_MANY,
			body_term: ISSUE_BODY,
		})

		expect(JSON.parse(json ?? EMPTY_PAGE)).toEqual([{ number: ISSUE_NUMBER, body: ISSUE_BODY }])
	})

	// `--search "#858 in:body"` matched a token, so it never matched inside `#8580`. A bare substring
	// test does, and the false positives fill the caller's cap ahead of an older genuine match.
	it('does not match the term inside a longer number', async () => {
		serve([rest_issue_page([{ body: 'blocked by #10220' }])])

		const json = await git_gh_issue_list.issue_list_open({
			json_fields: BODY_FIELDS,
			limit: LIMIT_MANY,
			body_term: '#1022',
		})

		expect(JSON.parse(json ?? '')).toEqual([])
	})
})

describe('issue_list_open — the search replacement, term boundaries', () => {
	// The same body with the term standing on its own is a match — the guard refuses a trailing
	// digit, not every occurrence.
	it('matches the term where it is not followed by a digit', async () => {
		serve([rest_issue_page([{ body: 'blocked by #10220, parent #1022.' }])])

		const json = await git_gh_issue_list.issue_list_open({
			json_fields: BODY_FIELDS,
			limit: LIMIT_MANY,
			body_term: '#1022',
		})

		expect(JSON.parse(json ?? '') as Array<{ number: number }>).toHaveLength(LIMIT_ONE)
	})

	// An issue with no body cannot mention the epic, which is the direction the search API took too.
	it('does not match an issue with no body', async () => {
		// eslint-disable-next-line unicorn/no-null -- REST answers JSON null for an issue with no body
		serve([rest_issue_page([{ body: null }])])

		const json = await git_gh_issue_list.issue_list_open({
			json_fields: BODY_FIELDS,
			limit: LIMIT_MANY,
			body_term: '#1022',
		})

		expect(JSON.parse(json ?? '')).toEqual([])
	})
})

describe('issue_list_open — the blocker relations', () => {
	// A listing carries no `blockedBy`; REST serves it from each issue's own dependencies endpoint,
	// and the `auto-ok` pickup fails open without it.
	it('answers blockedBy for a row that declares a blocker', async () => {
		serve([rest_issue_page([rest_dependencies_summary(LIMIT_ONE)])], rest_blockers())

		const rows = parse_listing(
			await git_gh_issue_list.issue_list_open({ json_fields: PICKUP_FIELDS, limit: LIMIT_MANY }),
		)

		expect(rows?.[0]?.blockedBy).toEqual({
			nodes: [{ number: BLOCKER_NUMBER, state: 'CLOSED' }],
			totalCount: LIMIT_ONE,
		})
		expect(api_paths().some((path) => path.includes(BLOCKED_BY_SEGMENT))).toBe(true)
	})

	// The whole point of reading the row's own dependency summary first: `gh` sent `blockedBy` inside
	// the listing, so one request per row would be a request per issue where `gh` made none.
	it('spends no request on a row GitHub reports as unblocked', async () => {
		serve([rest_issue_page([rest_dependencies_summary(0)])])

		const rows = parse_listing(
			await git_gh_issue_list.issue_list_open({ json_fields: PICKUP_FIELDS, limit: LIMIT_MANY }),
		)

		expect(rows?.[0]?.blockedBy).toEqual({ nodes: [], totalCount: 0 })
		expect(api_paths().some((path) => path.includes(BLOCKED_BY_SEGMENT))).toBe(false)
	})

	// A listing that never asks for the field never pays for it — the next-issues display and the
	// per-repository busy guard both read `SUMMARY_FIELDS`.
	it('spends no request when blockedBy was not asked for', async () => {
		serve([rest_issue_page([rest_dependencies_summary(LIMIT_ONE)])])

		await git_gh_issue_list.issue_list_open({ json_fields: SUMMARY_FIELDS, limit: LIMIT_MANY })

		expect(mocked_api).toHaveBeenCalledTimes(ONE_REQUEST)
	})

	// Relations that will not read take the listing with them. An empty `blockedBy` reads as "this
	// issue has no blockers", and the pickup would then start an issue before its prerequisite.
	it('answers undefined when the blocker relations cannot be read', async () => {
		mocked_api.mockImplementation(async (request) => {
			if (request.path.includes(BLOCKED_BY_SEGMENT)) throw new Error('HTTP 403')

			return rest_issue_page([rest_dependencies_summary(LIMIT_ONE)])
		})

		expect(
			await git_gh_issue_list.issue_list_open({ json_fields: PICKUP_FIELDS, limit: LIMIT_MANY }),
		).toBeUndefined()
	})
})
