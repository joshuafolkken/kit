import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_read } from './git-gh-issue-read'
import {
	BLOCKED_BY_SEGMENT,
	CURRENT_REPO_ISSUES,
	ISSUE_NUMBER,
	MERGED_AT,
	PULL_HTML_URL,
	rest_issue,
	rest_pull_request,
} from './git-gh-issue-rest-fixture'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#1052: `epic:bundle` keeps a pull request out of its candidates by the `/pull/`
// in the url it read (joshuafolkken/kit#947) — a guard that only works if the reference was read at
// all. That is what this file pins, and it is unchanged.
//
// What changed is the mechanism underneath it (joshuafolkken/kit#1066). A pull request carries no
// `issue_dependencies_summary`, and an absent summary is deliberately not read as a zero, so the
// numeric skip in `read_blocked_by` could never fire for one and the dependencies endpoint was asked
// every time. It answered a bare empty array — measured against a merged pull request while
// joshuafolkken/kit#1031 was written — and #1052 pinned that answer, because a 404 there would fail
// the whole read and report the reference as `unreadable` rather than dropping it.
//
// `read_blocked_by` now recognizes a pull request structurally and answers the empty relation without
// a request, so the guard no longer depends on what the endpoint replies. The mock below therefore
// makes that endpoint *fail*: it stands in for the 404 the old pin was defending against, and the
// read staying `read` proves the defense no longer rests on GitHub's behavior.
//
// Its own file rather than a section of `git-gh-issue-read.test.ts`, which is within a handful of
// lines of the three hundred a file may hold — the same reason `git-gh-issue-comments.test.ts` is
// separate.

const ISSUE_PATH = `${CURRENT_REPO_ISSUES}/${String(ISSUE_NUMBER)}`
const READ_NUMBER = String(ISSUE_NUMBER)
const MERGED_PULL_REQUEST = rest_issue(rest_pull_request(ISSUE_NUMBER, MERGED_AT))
// The hazard the skip exists for: GitHub answering the dependencies endpoint with anything but an
// empty array. Nothing may reach it, so any request there is a failure of the test.
const DEPENDENCIES_FAILED = 'gh: Not Found (HTTP 404)'

function serve_pull_request(): void {
	mocked_api.mockImplementation(async (request) => {
		if (request.path.includes(BLOCKED_BY_SEGMENT)) throw new Error(DEPENDENCIES_FAILED)

		return MERGED_PULL_REQUEST
	})
}

function api_paths(): Array<string> {
	return mocked_api.mock.calls.map(([request]) => request.path)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('the dependencies endpoint for a pull request', () => {
	// The saving is incidental — one request per pull-request reference — but it is what makes the
	// two tests below independent of what the endpoint would have replied.
	it('is not asked, since a pull request has no blocker relations to read', async () => {
		serve_pull_request()

		await git_gh_issue_read.issue_get_plan_fields_classified(READ_NUMBER)

		expect(api_paths()).toEqual([ISSUE_PATH])
	})

	// #1052's purpose, kept: `read`, not `unreadable`, so the reference reaches the `/pull/` check
	// that drops it instead of being reported as a gap nobody could look into. It now holds even
	// though the endpoint would have failed, which is the whole point of the structural skip.
	it('leaves the read succeeding even where the endpoint would answer 404', async () => {
		serve_pull_request()

		const read = await git_gh_issue_read.issue_get_plan_fields_classified(READ_NUMBER)

		expect(read.kind).toBe('read')
	})

	// The browser url is what carries `/pull/`, and the empty connection is what the epic readers see
	// for a pull request — no blockers, rather than a shape that failed to parse.
	it('answers the browser url and an empty connection', async () => {
		serve_pull_request()

		const json = await git_gh_issue_read.issue_get_plan_fields(READ_NUMBER)

		expect(JSON.parse(json ?? '{}')).toMatchObject({
			url: PULL_HTML_URL,
			blockedBy: { nodes: [], totalCount: 0 },
		})
	})
})
