import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_issue } from './git-gh-issue'
import { git_gh_issue_list } from './git-gh-issue-list'

// joshuafolkken/kit#1067: the page ceiling bounds every listing now, and a bound whose caller cannot
// see it was reached is a silently shortened answer. These six wrappers are where the flag either
// reaches a caller or is dropped, so the threading is pinned here rather than left to each command's
// own suite — a wrapper that started discarding it again would leave every one of those green.

vi.mock('./git-gh-issue-list', () => ({
	git_gh_issue_list: { issue_list_open: vi.fn() },
}))

const mocked_open = vi.mocked(git_gh_issue_list.issue_list_open)

const LABEL = 'auto-ok'
const REPO = 'joshuafolkken/app-kit'
const TERM = '#858'
const LIMIT = 50
const CAPPED = { json: '[]', is_capped: true }

// Every wrapper takes a different argument list, so each is named with a call rather than with the
// function alone — a table of bare references could not be invoked uniformly.
const WRAPPERS: ReadonlyArray<[string, () => Promise<unknown>]> = [
	['issue_list_recent', async () => await git_gh_issue.issue_list_recent(LIMIT)],
	['issue_list_open_bodies', async () => await git_gh_issue.issue_list_open_bodies(LIMIT)],
	['issue_search_body', async () => await git_gh_issue.issue_search_body(TERM, LIMIT)],
	['issue_list_by_label', async () => await git_gh_issue.issue_list_by_label(LABEL, LIMIT)],
	[
		'issue_list_by_label_summary',
		async () => await git_gh_issue.issue_list_by_label_summary(LABEL, LIMIT),
	],
	[
		'issue_list_by_label_in_repo',
		async () => await git_gh_issue.issue_list_by_label_in_repo(LABEL, LIMIT, REPO),
	],
]

beforeEach(() => {
	vi.clearAllMocks()
})

describe('the six open-issue listings', () => {
	it.each(WRAPPERS)('%s carries the truncation flag out to its caller', async (_name, call) => {
		mocked_open.mockResolvedValue(CAPPED)

		expect(await call()).toEqual(CAPPED)
	})

	// `undefined` rather than `'[]'` is what keeps "could not read" apart from "nothing is there", and
	// it is the contract joshuafolkken/kit#925 turns on. Threading the flag must not have widened it.
	it.each(WRAPPERS)('%s still answers undefined for a read that failed', async (_name, call) => {
		mocked_open.mockResolvedValue({ json: undefined, is_capped: false })

		expect(await call()).toEqual({ json: undefined, is_capped: false })
	})
})
