import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { json_value } from '#scripts/lib/json-value'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_etag_read } from './git-gh-etag-read'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue } from './git-gh-issue'
import { ISSUE_NUMBER, rest_issue_page } from './git-gh-issue-rest-fixture'
import { conditional_read_over } from './git-gh-pr-fixture'
import { TRANSPORT_ENV_VAR } from './git-gh-transport'

// joshuafolkken/kit#6560: `backlog:next` reads the `auto-ok` listing every scan, each scan a fresh
// process, so every page is sent with the ETag the previous scan kept. A page that has not changed is
// answered 304 and costs no rate limit.

const AUTO_OK = 'auto-ok'
const LIMIT = 50
const NEW_NUMBER = 6560
const OTHER_NUMBER = 6559
// Two rows at least: the fake takes a one-element array for a slurped page and unwraps it.
const FIRST_ROWS = [{ number: ISSUE_NUMBER }, { number: OTHER_NUMBER }]
const FIRST_PAGE = rest_issue_page(FIRST_ROWS)
const MOVED_PAGE = rest_issue_page([{ number: NEW_NUMBER }, ...FIRST_ROWS])

function serve_pages(...pages: Array<string>): void {
	const api = vi.spyOn(git_gh_exec, 'exec_gh_api')

	for (const page of pages) api.mockResolvedValueOnce(page)
	vi.spyOn(git_gh_conditional, 'read_conditional').mockImplementation(
		conditional_read_over(git_gh_exec.exec_gh_api),
	)
}

function sent_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

async function listed_numbers(): Promise<Array<unknown>> {
	const { json = '[]' } = await git_gh_issue.issue_list_by_label_summary(AUTO_OK, LIMIT, {
		json_fields: 'number',
	})

	return json_value.parse_array(json) ?? []
}

// The ETag belongs to the REST listing; a session on GraphQL reads it in one query instead
// (joshuafolkken/kit#6785).
beforeEach(() => {
	vi.restoreAllMocks()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	shared_cache_fixture.keep_in_memory()
})

describe('issue_list — the previous ETag', () => {
	it('sends the previous ETag and answers the previous rows on a 304', async () => {
		serve_pages(FIRST_PAGE, FIRST_PAGE)

		const first = await listed_numbers()

		expect(await listed_numbers()).toStrictEqual(first)
		expect(first).toStrictEqual(FIRST_ROWS)
		expect(sent_etags()).toStrictEqual([undefined, FIRST_PAGE])
	})

	it('answers the new rows when the page changed', async () => {
		serve_pages(FIRST_PAGE, MOVED_PAGE)

		await listed_numbers()

		expect(await listed_numbers()).toStrictEqual([{ number: NEW_NUMBER }, ...FIRST_ROWS])
		expect(sent_etags()).toStrictEqual([undefined, FIRST_PAGE])
	})
})

// joshuafolkken/kit#7306: a listing is unchanged only when every page it read answered 304.
const FULL_PAGE_ROWS = 100
const TWO_PAGE_LIMIT = 150
const FULL_PAGE = rest_issue_page(
	Array.from({ length: FULL_PAGE_ROWS }, (_, index) => ({ number: index + 1 })),
)

function serve_details(...unchanged: Array<boolean>): void {
	const read = vi.spyOn(git_gh_etag_read, 'read_detail')

	read.mockResolvedValueOnce({ body: FULL_PAGE, is_unchanged: unchanged[0] === true })
	read.mockResolvedValueOnce({ body: FIRST_PAGE, is_unchanged: unchanged[1] === true })
}

async function two_page_unchanged(): Promise<boolean> {
	const listing = await git_gh_issue.issue_list_by_label_summary(AUTO_OK, TWO_PAGE_LIMIT, {
		json_fields: 'number',
	})

	expect(vi.mocked(git_gh_etag_read.read_detail)).toHaveBeenCalledTimes(2)

	return listing.is_unchanged === true
}

describe('issue_list — is_unchanged across pages', () => {
	it('is unchanged when every page answered 304', async () => {
		serve_details(true, true)

		expect(await two_page_unchanged()).toBe(true)
	})

	it('is changed when a 304 page is followed by a changed one', async () => {
		serve_details(true, false)

		expect(await two_page_unchanged()).toBe(false)
	})
})
