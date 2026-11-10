import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_issue_memo } from './git-gh-issue-memo'
import { git_gh_issue_read, NOT_FOUND_STATUS } from './git-gh-issue-read'
import {
	BLOCKED_BY_SEGMENT,
	BLOCKER_NUMBER,
	CURRENT_REPO_ISSUES,
	ISSUE_NUMBER,
	MERGED_AT,
	PULL_HTML_URL,
	rest_blockers,
	rest_issue,
	rest_pull_request,
} from './git-gh-issue-rest-fixture'

// The requests `git_gh_issue_read` makes beside the issue itself — its relations, its author and its
// comments. Kept apart from `git-gh-issue-read.test.ts`, which is at the 300 lines a file may hold.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

// The relations reads go through `exec_gh_api` here; the ETag is pinned in `git-gh-issue-read-etag.test.ts`.
vi.mock('./git-gh-etag-read', () => ({
	git_gh_etag_read: { read: async (path: string) => await git_gh_exec.exec_gh_api({ path }) },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_status = vi.mocked(git_gh_exec.exec_gh_api_status)
const READ_NUMBER = String(ISSUE_NUMBER)

// Each test answers the same issue differently, so none may be served the previous test's read.
beforeEach(() => {
	git_gh_issue_memo.forget()
})

// joshuafolkken/kit#1690: one read makes two requests, and only the first resolves the number. The
// relations endpoint is reached after the issue itself came back, so its own 404 — the endpoint
// absent on an older host, which `has_no_relations_endpoint` handles for the other entry point —
// must never report an issue that exists as missing.

// The issue itself answers; the relations request behind it does not.
const GH_WORDING = 'gh: some wording or other'

function reject_relations(status: number | undefined): void {
	const error = gh_failure.attach(new Error(GH_WORDING), { status })

	mocked_api.mockImplementation(async (request) => {
		await Promise.resolve()
		if (request.path.includes(BLOCKED_BY_SEGMENT)) throw error

		return rest_issue()
	})
}

describe('issue_view_json_classified — which of the two requests failed', () => {
	it('does not report the issue as missing when the relations endpoint answered 404', async () => {
		reject_relations(NOT_FOUND_STATUS)

		await expect(
			git_gh_issue_read.issue_view_json_classified(READ_NUMBER, 'blockedBy'),
		).resolves.toEqual({
			kind: 'unreadable',
			reason: 'rejected',
			status: NOT_FOUND_STATUS,
			detail: GH_WORDING,
		})
	})

	// The rest of the classification is untouched: a follow-up request that never reached GitHub is
	// still the transport case, and still worth asking about again.
	it('still reports a relations read that reached no status as unreachable', async () => {
		reject_relations(undefined)

		await expect(
			git_gh_issue_read.issue_view_json_classified(READ_NUMBER, 'blockedBy'),
		).resolves.toEqual({
			kind: 'unreadable',
			reason: 'unreachable',
			status: undefined,
			detail: GH_WORDING,
		})
	})
})

// joshuafolkken/kit#4633: `backlog:next` offers an epic child only when its author has write access,
// so the read every epic child goes through answers who filed it beside its state.
const NO_BLOCKERS = '[]'

describe('issue_get_state_and_relations_classified — who filed the issue', () => {
	it('answers the author fields beside the state', async () => {
		const issue = rest_issue({ author_association: 'NONE', user: { login: 'outsider' } })

		mocked_api.mockImplementation(async (request) =>
			request.path.includes(BLOCKED_BY_SEGMENT) ? NO_BLOCKERS : issue,
		)

		const read = await git_gh_issue_read.issue_get_state_and_relations_classified(READ_NUMBER)

		expect(read.kind === 'read' ? read.json : '').toContain(
			'"author_association":"NONE","user":{"login":"outsider"}',
		)
	})
})

const RATE_LIMITED_STATUS = 429
const RATE_LIMIT_MESSAGE = 'API rate limit exceeded'

// joshuafolkken/kit#1113: the relations read that does not consult the issue's summary count, for
// the one caller that has to know whether a relation is really absent rather than merely uncounted.
describe('issue_blocked_by_numbers', () => {
	it('answers the listing rather than the summary', async () => {
		mocked_api.mockResolvedValueOnce(rest_blockers())

		await expect(git_gh_issue_read.issue_blocked_by_numbers(READ_NUMBER)).resolves.toStrictEqual([
			BLOCKER_NUMBER,
		])
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	// `read_blocked_by` skips a pull request structurally (joshuafolkken/kit#1066); this entry point
	// has no issue payload to make that call from, so it reads the endpoint's own answer instead. A
	// pull request pasted into an epic's task list must not become a warning about a lost relation.
	it('answers no relations when the endpoint has nothing at that number', async () => {
		mocked_api.mockRejectedValueOnce(new Error('not found'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await expect(git_gh_issue_read.issue_blocked_by_numbers(READ_NUMBER)).resolves.toStrictEqual([])
	})

	// A rate limit is a gap, not an answer: swallowing it would report a real relation as absent.
	it('raises when the read failed over something other than the number', async () => {
		mocked_api.mockRejectedValueOnce(new Error(RATE_LIMIT_MESSAGE))
		mocked_status.mockResolvedValueOnce(RATE_LIMITED_STATUS)

		await expect(git_gh_issue_read.issue_blocked_by_numbers(READ_NUMBER)).rejects.toThrow(
			RATE_LIMIT_MESSAGE,
		)
	})
})

// joshuafolkken/kit#1039: the epic auto-close reads an epic's own comments to see whether a previous
// run already posted its closing announcement — the comment `issue_close` posts before it changes
// the state, and so the one a half-succeeded run leaves behind.
const COMMENTED_ISSUE = '1039'
const COMMENTS_PATH = `${CURRENT_REPO_ISSUES}/${COMMENTED_ISSUE}/comments`
const COMMENT_LISTING = '[{"body":"a plan comment"}]'
const WATCH_TIMEOUT_MS = 5000
const OTHER_REPO = 'joshuafolkken/app-kit'

describe('issue_list_comments', () => {
	// Paged, because the comment being looked for is the newest one while REST answers thirty rows. The
	// endpoint serves a bare array, which `--paginate` merges on its own — `--slurp` would wrap the
	// pages as `[[…],[…]]` and every array schema would then reject it, so the whole request is
	// asserted rather than only its path.
	it('reads the comments endpoint one full page at a time, and never slurped', async () => {
		mocked_api.mockResolvedValueOnce(COMMENT_LISTING)

		await expect(git_gh_issue_read.issue_list_comments(COMMENTED_ISSUE)).resolves.toBe(
			COMMENT_LISTING,
		)
		expect(mocked_api.mock.calls[0]?.[0]).toStrictEqual({
			path: `${COMMENTS_PATH}?per_page=100`,
			should_paginate: true,
			timeout_ms: undefined,
		})
	})

	// joshuafolkken/kit#3773: the issue watch runs inside a hook, so its read carries a short timeout.
	it('passes a timeout through to the read', async () => {
		mocked_api.mockResolvedValueOnce(COMMENT_LISTING)

		await git_gh_issue_read.issue_list_comments(COMMENTED_ISSUE, WATCH_TIMEOUT_MS)

		expect(mocked_api.mock.calls[0]?.[0]).toMatchObject({ timeout_ms: WATCH_TIMEOUT_MS })
	})

	// `undefined` rather than `'[]'`: the caller has to tell "no announcement is there" from "nobody
	// looked", because posting on the second answer is the duplicate it exists to prevent.
	it('returns undefined when the read failed', async () => {
		mocked_api.mockRejectedValueOnce(new Error(RATE_LIMIT_MESSAGE))

		await expect(git_gh_issue_read.issue_list_comments(COMMENTED_ISSUE)).resolves.toBeUndefined()
	})

	// joshuafolkken/kit#5851: `issue:read --repo` reads another repository's thread, so the listing must
	// ask that repository — the same number in the session's repository is a different issue.
	it('reads the comments of the repository it is given', async () => {
		mocked_api.mockResolvedValueOnce(COMMENT_LISTING)

		await git_gh_issue_read.issue_list_comments(COMMENTED_ISSUE, undefined, OTHER_REPO)

		expect(mocked_api.mock.calls[0]?.[0]).toMatchObject({
			path: `repos/${OTHER_REPO}/issues/${COMMENTED_ISSUE}/comments?per_page=100`,
		})
	})
})

// joshuafolkken/kit#1052: `epic:bundle` keeps a pull request out of its candidates by the `/pull/`
// in the url it read (joshuafolkken/kit#947) — a guard that only works if the reference was read at
// all. That is what this section pins, and it is unchanged.
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
const ISSUE_PATH = `${CURRENT_REPO_ISSUES}/${READ_NUMBER}`
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
