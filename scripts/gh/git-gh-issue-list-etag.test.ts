import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { json_value } from '#scripts/lib/json-value'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue } from './git-gh-issue'
import { ISSUE_NUMBER, rest_issue_page } from './git-gh-issue-rest-fixture'
import { conditional_read_over } from './git-gh-pr-fixture'

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

beforeEach(() => {
	vi.restoreAllMocks()
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
