import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { rest_issue_page } from '#scripts/gh/git-gh-issue-rest-fixture'
import { conditional_read_over } from '#scripts/gh/git-gh-pr-fixture'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_scout } from './issue-scout'
import { issue_scout_closed } from './issue-scout-closed'

// joshuafolkken/kit#6560: every `issue:file` scouts the listings again, each in a fresh process, so
// the listing is sent with the ETag the previous scout kept; a 304 answers the previous rows, and a
// listing that moved is matched as it reads now.

const TITLE = 'Read the auto-ok listing through the conditional request layer'
const OLD_NUMBER = 41
const NEW_NUMBER = 42
const OTHER_NUMBER = 40
// Unlabelled closed issues, since the scout passes over epics.
const CLOSED = { state: 'closed', labels: [] }
// Two rows at least: the fake takes a one-element array for a slurped page and unwraps it.
const OLD_ROWS = [
	{ ...CLOSED, number: OLD_NUMBER, title: 'Trim the README' },
	{ ...CLOSED, number: OTHER_NUMBER, title: 'Pin the lint config' },
]
const OLD_PAGE = rest_issue_page(OLD_ROWS)
const MOVED_PAGE = rest_issue_page([{ ...CLOSED, number: NEW_NUMBER, title: TITLE }, ...OLD_ROWS])

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

async function scout_matches(): Promise<Array<number>> {
	const { rows } = await issue_scout_closed.read_recently_closed()

	return issue_scout.find_duplicates(TITLE, rows ?? []).candidates.map(({ number }) => number)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
})

describe('issue:scout — the previous ETag', () => {
	it('sends the previous ETag and scouts the previous rows on a 304', async () => {
		serve_pages(OLD_PAGE, OLD_PAGE)
		await issue_scout_closed.read_recently_closed()

		const { rows } = await issue_scout_closed.read_recently_closed()

		expect(rows?.map(({ number }) => number)).toStrictEqual([OLD_NUMBER, OTHER_NUMBER])
		expect(sent_etags()).toStrictEqual([undefined, OLD_PAGE])
	})

	it('matches against the new rows when the listing changed', async () => {
		serve_pages(OLD_PAGE, MOVED_PAGE)

		expect(await scout_matches()).toStrictEqual([])
		expect(await scout_matches()).toStrictEqual([NEW_NUMBER])
		expect(sent_etags()).toStrictEqual([undefined, OLD_PAGE])
	})
})
