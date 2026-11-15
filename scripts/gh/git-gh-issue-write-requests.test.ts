import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_issue_write } from './git-gh-issue-write'

// The label writes and the writes addressed to another repository. Kept apart from
// `git-gh-issue-write.test.ts`, which is at the 300 lines a file may hold.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
// The label read-back's first page, answered through the ETag layer (joshuafolkken/kit#7619).
const read_conditional = vi.spyOn(git_gh_conditional, 'read_conditional')

beforeEach(() => {
	shared_cache_fixture.keep_in_memory()
	mocked_api.mockReset().mockResolvedValue('')
	read_conditional.mockReset()
})

// joshuafolkken/kit#3312: a write that threw after the label landed refused a lane dispatch, so a
// throw is confirmed by reading the labels back before it counts as a failure.
const LABELED_ISSUE = '3291'
const LABEL_NAME = 'in-progress'
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
const ISSUE_LABELS_PATH = `${ISSUES_PATH}/${LABELED_ISSUE}/labels`
const LABELS_PAGE_PATH = `${ISSUE_LABELS_PATH}${FULL_PAGE_QUERY}`
const WRITE_FAILED = 'gh: API rate limit exceeded (HTTP 403)'
const UNREADABLE: ConditionalRead = { kind: 'unreadable' }

function labels_page(...names: Array<string>): ConditionalRead {
	return { kind: 'changed', etag: undefined, body: JSON.stringify(names.map((name) => ({ name }))) }
}

// The POST throws; the read-back answers `read_back`.
function serve_failed_write(read_back: ConditionalRead): void {
	mocked_api.mockRejectedValue(new Error(WRITE_FAILED))
	read_conditional.mockResolvedValue(read_back)
}

async function apply(): Promise<unknown> {
	return await git_gh_issue_write.issue_apply_label(LABELED_ISSUE, LABEL_NAME)
}

describe('issue_apply_label', () => {
	it('reads nothing back when the write succeeds', async () => {
		expect(await apply()).toStrictEqual({ is_applied: true })
		expect(mocked_api).toHaveBeenCalledTimes(1)
		expect(read_conditional).not.toHaveBeenCalled()
	})

	it('counts a thrown write as applied when the read-back finds the label', async () => {
		serve_failed_write(labels_page('bug', LABEL_NAME))

		expect(await apply()).toStrictEqual({ is_applied: true })
		expect(read_conditional.mock.calls[0]?.[0]).toBe(LABELS_PAGE_PATH)
	})

	it('answers the write error when the read-back does not find the label', async () => {
		serve_failed_write(labels_page('bug'))

		expect(await apply()).toStrictEqual({ is_applied: false, reason: WRITE_FAILED })
	})

	it('keeps only the first line of the write error as the reason', async () => {
		mocked_api.mockRejectedValue(new Error(`${WRITE_FAILED}\n{"message":"Not Found"}`))

		expect(await apply()).toStrictEqual({ is_applied: false, reason: WRITE_FAILED })
	})

	it('answers the write error when the read-back itself fails', async () => {
		serve_failed_write(UNREADABLE)

		expect(await apply()).toStrictEqual({ is_applied: false, reason: WRITE_FAILED })
	})

	it('keeps issue_add_label answering the same verdict as a boolean', async () => {
		serve_failed_write(labels_page(LABEL_NAME))

		expect(await git_gh_issue_write.issue_add_label(LABELED_ISSUE, LABEL_NAME)).toBe(true)
	})
})

// joshuafolkken/kit#7619: the label read's first page goes through the ETag layer, a full one falls
// back to a paginated read parsed the same way, and a failed read answers `undefined`.
async function read(): Promise<Array<string> | undefined> {
	return await git_gh_issue_write.read_label_names(LABELED_ISSUE)
}

describe('read_label_names', () => {
	it('answers the same names from the kept page on a 304', async () => {
		const etag = 'W/"labels"'
		const body = JSON.stringify([{ name: LABEL_NAME }])

		read_conditional
			.mockResolvedValueOnce({ kind: 'changed', etag, body })
			.mockResolvedValueOnce({ kind: 'unchanged' })

		expect(await read()).toStrictEqual([LABEL_NAME])
		expect(await read()).toStrictEqual([LABEL_NAME])
		expect(read_conditional.mock.calls[1]).toStrictEqual([LABELS_PAGE_PATH, etag, undefined])
	})

	it('reads every page with --paginate when the first page is full', async () => {
		const names = Array.from(
			{ length: git_gh_api_path.FULL_PAGE_SIZE },
			(_, index) => `l${String(index)}`,
		)

		read_conditional.mockResolvedValue(labels_page(...names))
		mocked_api.mockResolvedValue(JSON.stringify([...names, LABEL_NAME].map((name) => ({ name }))))

		expect(await read()).toContain(LABEL_NAME)
		expect(mocked_api).toHaveBeenCalledWith({ path: LABELS_PAGE_PATH, should_paginate: true })
	})

	it('answers an empty list for an issue with no labels', async () => {
		read_conditional.mockResolvedValue(labels_page())

		expect(await read()).toStrictEqual([])
	})

	it('answers undefined when the read fails', async () => {
		read_conditional.mockResolvedValue(UNREADABLE)

		expect(await read()).toBeUndefined()
	})
})

// The DELETE throws; the read-back answers `read_back`.
function serve_failed_delete(read_back: ConditionalRead): void {
	mocked_api.mockRejectedValue(new Error(WRITE_FAILED))
	read_conditional.mockResolvedValue(read_back)
}

async function clear(): Promise<boolean> {
	return await git_gh_issue_write.issue_clear_label(LABELED_ISSUE, LABEL_NAME)
}

describe('issue_clear_label', () => {
	it('answers true when the delete succeeds', async () => {
		expect(await clear()).toBe(true)
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	it('answers true when the delete throws and the read-back lacks the label', async () => {
		serve_failed_delete(labels_page('bug'))

		expect(await clear()).toBe(true)
	})

	it('answers false when the delete throws and the read-back still has the label', async () => {
		serve_failed_delete(labels_page('bug', LABEL_NAME))

		expect(await clear()).toBe(false)
	})

	it('answers false when the delete throws and the read-back itself fails', async () => {
		serve_failed_delete(UNREADABLE)

		expect(await clear()).toBe(false)
	})
})

// joshuafolkken/kit#3591: `label_ensure` read every failure as "the label already exists", so a
// refused credential, a rate limit and a dropped connection all left no trace.
const ENSURED_LABEL = 'epic'
const VALIDATION_FAILED = 'gh: Validation Failed (HTTP 422)'
const FORBIDDEN = 'gh: Forbidden (HTTP 403)'
const CONNECTION_FAILED = 'error connecting to api.github.com'
const FORBIDDEN_DOCUMENT = '{"message":"Forbidden","status":"403"}'
const warnings: Array<string> = []

// The 422 document GitHub answers a label write with; `code` is what tells an existing label from
// any other validation failure.
function validation_document(code: string): string {
	return JSON.stringify({
		message: 'Validation Failed',
		errors: [{ resource: 'Label', code, field: 'name' }],
		status: '422',
	})
}

// The error `exec_gh_api` throws: stderr's summary line, then the response body gh wrote to stdout,
// with the status classified from that body (`to_gh_error`).
function gh_error(summary: string, stdout: string): Error {
	const message = stdout.length > 0 ? `${summary}\n${stdout}` : summary

	return gh_failure.attach(new Error(message), gh_failure.classify_stdout(stdout))
}

async function ensure_label(): Promise<void> {
	await git_gh_issue_write.label_ensure({ name: ENSURED_LABEL, color: '5319e7', description: '' })
}

function capture_warnings(): void {
	warnings.length = 0
	vi.spyOn(console, 'warn').mockImplementation((line: string) => {
		warnings.push(line)
	})
}

describe('label_ensure — which failure means the label is there', () => {
	beforeEach(capture_warnings)

	// An existing label answers 422 `already_exists`, which is not an error here: the `|| true`
	// semantics the `gh label create` wrapper had.
	it('says nothing when the label already exists', async () => {
		mocked_api.mockRejectedValue(gh_error(VALIDATION_FAILED, validation_document('already_exists')))

		await expect(ensure_label()).resolves.toBeUndefined()
		expect(warnings).toStrictEqual([])
	})

	it.each([
		['a 422 for another reason', VALIDATION_FAILED, validation_document('invalid')],
		['a refused credential', FORBIDDEN, FORBIDDEN_DOCUMENT],
		['a request that never arrived', CONNECTION_FAILED, ''],
	])('warns about %s rather than reading it as an existing label', async (_name, summary, body) => {
		mocked_api.mockRejectedValue(gh_error(summary, body))

		await expect(ensure_label()).resolves.toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings.join('\n')).toContain(`\`${ENSURED_LABEL}\``)
		expect(warnings.join('\n')).toContain(summary)
	})
})

// joshuafolkken/kit#4134: `josh issue:plan --repo` addresses the title, the body and the comment to
// another repository's issue, so each write's path names that repository, not gh's placeholder.
const OTHER_ISSUE = '7'
const OTHER_REPO = 'joshuafolkken/app-kit'
const OTHER_ISSUE_PATH = `repos/${OTHER_REPO}/issues/${OTHER_ISSUE}`
const ISSUE_URL = `https://github.com/${OTHER_REPO}/issues/${OTHER_ISSUE}`
const BODY = '## Plan\n- step one\n'
const TITLE = 'A clearer title'

function first_request(): GhApiRequest {
	const [call] = mocked_api.mock.calls
	if (call === undefined) throw new Error('gh api was not called')

	return call[0]
}

describe('issue writes — naming another repository', () => {
	beforeEach(() => {
		mocked_api.mockResolvedValue(ISSUE_URL)
	})

	it('patches the body of that repository issue', async () => {
		await git_gh_issue_write.issue_edit_body(OTHER_ISSUE, BODY, OTHER_REPO)

		expect(first_request()).toMatchObject({ path: OTHER_ISSUE_PATH, method: 'PATCH' })
	})

	it('patches the title of that repository issue', async () => {
		await git_gh_issue_write.issue_edit_title(OTHER_ISSUE, TITLE, OTHER_REPO)

		expect(first_request()).toMatchObject({ path: OTHER_ISSUE_PATH, method: 'PATCH' })
	})

	it('posts the comment to that repository issue', async () => {
		await git_gh_issue_write.issue_comment(OTHER_ISSUE, BODY, OTHER_REPO)

		expect(first_request().path).toBe(`${OTHER_ISSUE_PATH}/comments`)
	})

	// joshuafolkken/kit#4821: the deferral note `issue:file` posts names the finder's repository, so it
	// lands there even while `GH_REPO` points the filing's listings at another target.
	it('posts the counted comment to that repository issue', async () => {
		await git_gh_issue_write.issue_try_comment(OTHER_ISSUE, BODY, OTHER_REPO)

		expect(first_request().path).toBe(`${OTHER_ISSUE_PATH}/comments`)
	})

	// joshuafolkken/kit#4717: a 502 can follow an issue GitHub already opened, so a retried creation
	// could open a second one.
	it('creates that repository issue without the transient-error retry', () => {
		const request = git_gh_issue_write.issue_create_request({
			title: TITLE,
			body: BODY,
			repo: OTHER_REPO,
		})

		expect(request.should_retry).toBe(false)
	})
})
