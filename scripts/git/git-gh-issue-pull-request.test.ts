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
// all.
//
// A pull request carries no `issue_dependencies_summary`, and an absent summary is not a zero, so
// the skip that settles the common case in `read_blocked_by` cannot fire for one: the dependencies
// endpoint is asked every time. It answers a bare empty array, measured against a merged pull
// request while joshuafolkken/kit#1031 was written. A 404 there would instead fail the whole read,
// and the reference would be reported as `unreadable` rather than dropped — which is why the answer
// is pinned here rather than left as something the live API happens to do.
//
// Its own file rather than a section of `git-gh-issue-read.test.ts`, which is within a handful of
// lines of the three hundred a file may hold — the same reason `git-gh-issue-comments.test.ts` is
// separate.

const ISSUE_PATH = `${CURRENT_REPO_ISSUES}/${String(ISSUE_NUMBER)}`
const BLOCKED_BY_PATH = `${ISSUE_PATH}${BLOCKED_BY_SEGMENT}?per_page=100`
// What the dependencies endpoint actually answers for a pull request.
const NO_BLOCKERS = '[]'
const READ_NUMBER = String(ISSUE_NUMBER)
const MERGED_PULL_REQUEST = rest_issue(rest_pull_request(ISSUE_NUMBER, MERGED_AT))

function serve_pull_request(): void {
	mocked_api.mockImplementation(async (request) =>
		request.path.includes(BLOCKED_BY_SEGMENT) ? NO_BLOCKERS : MERGED_PULL_REQUEST,
	)
}

function api_paths(): Array<string> {
	return mocked_api.mock.calls.map(([request]) => request.path)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('the dependencies endpoint for a pull request', () => {
	it('is asked, since a pull request carries no dependency summary to skip on', async () => {
		serve_pull_request()

		await git_gh_issue_read.issue_get_plan_fields_classified(READ_NUMBER)

		expect(api_paths()).toEqual([ISSUE_PATH, BLOCKED_BY_PATH])
	})

	// `read`, not `unreadable`: the empty array is a successful read, so the reference reaches the
	// `/pull/` check that drops it instead of being reported as a gap nobody could look into.
	it('leaves the read succeeding when it answers an empty array', async () => {
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
