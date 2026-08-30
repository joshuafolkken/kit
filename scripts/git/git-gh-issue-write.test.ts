import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#1026: the writes go through `gh api` because `gh <noun> <verb>` is GraphQL,
// which a cloud session is answered 403 for. Every path asserted here was measured against the live
// API on a pair of throwaway issues before it was written.
const ISSUE_NUMBER = '1035'
const BLOCKER_NUMBER = '1036'
const BLOCKER_ID = 5_288_051_223
const ISSUES_PATH = 'repos/{owner}/{repo}/issues'
const ISSUE_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}`
const BLOCKER_PATH = `${ISSUES_PATH}/${BLOCKER_NUMBER}`
const LABELS_PATH = 'repos/{owner}/{repo}/labels'
const COMMENTS_PATH = `${ISSUE_PATH}/comments`
const ISSUE_LABELS_PATH = `${ISSUE_PATH}/labels`
const BLOCKED_BY_PATH = `${ISSUE_PATH}/dependencies/blocked_by`
const ID_FILTER = '.id'
const HTML_URL_FILTER = '.html_url'
const ISSUE_URL = `https://github.com/joshuafolkken/kit/issues/${ISSUE_NUMBER}`
const MULTILINE_BODY = 'first line\n\n- second `line`\n'
const LABEL_NAME = 'epic'
const LABEL_DESCRIPTION = 'Tracks a batch of child issues from one split'
const HASH_COLOR = '#5319e7'
const BARE_COLOR = '5319e7'
const EPIC_TITLE = 'Convert the GitHub calls to REST'
const CLOSE_COMMENT = 'All child issues are closed. Closing this epic automatically.'
const WRITE_FAILED = 'gh: Not Found (HTTP 404)'
const TWO_REQUESTS = 2

function requests(): Array<GhApiRequest> {
	return mocked_api.mock.calls.map(([request]) => request)
}

// Indexed rather than destructured so a request that was never made fails the test with a message
// naming the index, instead of a type assertion papering over an `undefined`.
function request_at(index: number): GhApiRequest {
	const request = requests()[index]
	if (request === undefined) throw new Error(`gh api was not called ${String(index + 1)} time(s)`)

	return request
}

function first_request(): GhApiRequest {
	return request_at(0)
}

function parsed_body(request: GhApiRequest): unknown {
	return JSON.parse(request.body ?? '')
}

// The blocker's database id, answered for the read that resolves it, and the issue URL for anything
// else — the two shapes `jq_filter` unwraps in this module.
function serve_id(id = String(BLOCKER_ID)): void {
	mocked_api.mockImplementation(async (request) =>
		request.jq_filter === ID_FILTER ? id : ISSUE_URL,
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_api.mockResolvedValue(ISSUE_URL)
})

describe('issue_edit_body', () => {
	it('patches the issue and answers the browser URL', async () => {
		const url = await git_gh_issue_write.issue_edit_body(ISSUE_NUMBER, MULTILINE_BODY)

		expect(url).toBe(ISSUE_URL)
		expect(first_request()).toMatchObject({ path: ISSUE_PATH, method: 'PATCH' })
	})

	// The body travels as a JSON payload on stdin, so multi-line markdown depends on no shell
	// quoting — the guarantee `--body-file -` gave before.
	it('sends the body as JSON rather than as an argv string', () => {
		void git_gh_issue_write.issue_edit_body(ISSUE_NUMBER, MULTILINE_BODY)

		expect(parsed_body(first_request())).toStrictEqual({ body: MULTILINE_BODY })
	})
})

describe('issue_comment', () => {
	it('posts to the comments endpoint and answers the comment URL', async () => {
		const url = await git_gh_issue_write.issue_comment(ISSUE_NUMBER, MULTILINE_BODY)

		expect(url).toBe(ISSUE_URL)
		expect(first_request().path).toBe(COMMENTS_PATH)
		expect(parsed_body(first_request())).toStrictEqual({ body: MULTILINE_BODY })
	})

	// `gh api` promotes a request carrying `--input` to POST, so a creation names no method — and
	// naming PATCH here would edit the issue instead of commenting on it.
	it('names no method, so gh sends POST for the body', () => {
		void git_gh_issue_write.issue_comment(ISSUE_NUMBER, MULTILINE_BODY)

		expect(first_request().method).toBeUndefined()
	})
})

describe('issue_close', () => {
	it('posts the comment first, then patches the state to closed', async () => {
		const is_closed = await git_gh_issue_write.issue_close(ISSUE_NUMBER, CLOSE_COMMENT)

		expect(is_closed).toBe(true)
		expect(requests()).toHaveLength(TWO_REQUESTS)
		expect(request_at(0).path).toBe(COMMENTS_PATH)
		expect(request_at(1)).toMatchObject({ path: ISSUE_PATH, method: 'PATCH' })
		expect(parsed_body(request_at(1))).toStrictEqual({ state: 'closed' })
	})

	// The order is what keeps `false` meaning "the issue is still open": the state change is last, so
	// a failed comment never leaves a closed issue reported as unclosed.
	it('returns false and never sends the close request when the comment fails', async () => {
		mocked_api.mockRejectedValue(new Error(WRITE_FAILED))

		expect(await git_gh_issue_write.issue_close(ISSUE_NUMBER, CLOSE_COMMENT)).toBe(false)
		expect(requests()).toHaveLength(1)
		expect(request_at(0).path).toBe(COMMENTS_PATH)
	})

	it('returns false when the comment lands but the state change fails', async () => {
		mocked_api.mockResolvedValueOnce(ISSUE_URL).mockRejectedValueOnce(new Error(WRITE_FAILED))

		expect(await git_gh_issue_write.issue_close(ISSUE_NUMBER, CLOSE_COMMENT)).toBe(false)
		expect(requests()).toHaveLength(TWO_REQUESTS)
	})

	// joshuafolkken/kit#1039: the case the split ordering costs — a previous run's comment landed and
	// its close was refused, so the retry has to close without posting a second copy.
	it('sends only the state change when there is no comment to post', async () => {
		const is_closed = await git_gh_issue_write.issue_close(ISSUE_NUMBER, undefined)

		expect(is_closed).toBe(true)
		expect(requests()).toHaveLength(1)
		expect(request_at(0)).toMatchObject({ path: ISSUE_PATH, method: 'PATCH' })
		expect(parsed_body(request_at(0))).toStrictEqual({ state: 'closed' })
	})

	// The return value keeps meaning what it meant: with no comment to post, the state change is not
	// merely the last thing attempted but the only one.
	it('returns false when the state change fails with no comment to post', async () => {
		mocked_api.mockRejectedValue(new Error(WRITE_FAILED))

		expect(await git_gh_issue_write.issue_close(ISSUE_NUMBER, undefined)).toBe(false)
		expect(requests()).toHaveLength(1)
	})
})

describe('label_ensure', () => {
	// REST answers 422 `{"resource":"Label","code":"invalid","field":"color"}` for `#5319e7`, which
	// `gh label create` accepted and stripped itself.
	it('drops the leading hash from the color', async () => {
		await git_gh_issue_write.label_ensure({
			name: LABEL_NAME,
			color: HASH_COLOR,
			description: LABEL_DESCRIPTION,
		})

		expect(first_request().path).toBe(LABELS_PATH)
		expect(parsed_body(first_request())).toStrictEqual({
			name: LABEL_NAME,
			color: BARE_COLOR,
			description: LABEL_DESCRIPTION,
		})
	})

	it('leaves a color that carries no hash alone', async () => {
		await git_gh_issue_write.label_ensure({
			name: LABEL_NAME,
			color: BARE_COLOR,
			description: LABEL_DESCRIPTION,
		})

		expect(parsed_body(first_request())).toMatchObject({ color: BARE_COLOR })
	})

	// An existing label answers 422 `already_exists`, which is not an error here: the `|| true`
	// semantics the `gh label create` wrapper had.
	it('does not throw when the label already exists', async () => {
		mocked_api.mockRejectedValue(new Error('gh: Validation Failed (HTTP 422)'))

		await expect(
			git_gh_issue_write.label_ensure({
				name: LABEL_NAME,
				color: HASH_COLOR,
				description: LABEL_DESCRIPTION,
			}),
		).resolves.toBeUndefined()
	})
})

describe('issue_create_with_label', () => {
	// `git-epic-run.ts` parses the epic's number back out of this answer, so the shape has to stay
	// the browser URL `gh issue create` printed.
	it('creates the issue with its label and answers the browser URL', async () => {
		const url = await git_gh_issue_write.issue_create_with_label({
			title: EPIC_TITLE,
			label: LABEL_NAME,
			body: MULTILINE_BODY,
		})

		expect(url).toBe(ISSUE_URL)
		expect(first_request()).toMatchObject({ path: ISSUES_PATH, jq_filter: HTML_URL_FILTER })
		expect(parsed_body(first_request())).toStrictEqual({
			title: EPIC_TITLE,
			labels: [LABEL_NAME],
			body: MULTILINE_BODY,
		})
	})
})

describe('issue_add_label', () => {
	it('posts the label to the issue and answers true', async () => {
		expect(await git_gh_issue_write.issue_add_label(ISSUE_NUMBER, LABEL_NAME)).toBe(true)
		expect(first_request().path).toBe(ISSUE_LABELS_PATH)
		expect(parsed_body(first_request())).toStrictEqual({ labels: [LABEL_NAME] })
	})

	it('answers false when the write fails', async () => {
		mocked_api.mockRejectedValue(new Error(WRITE_FAILED))

		expect(await git_gh_issue_write.issue_add_label(ISSUE_NUMBER, LABEL_NAME)).toBe(false)
	})
})

describe('issue_add_blocked_by', () => {
	// The endpoint takes a database id and does not check it names an issue in this repository:
	// posting `{"issue_id":1036}` to a scratch issue recorded an unrelated repository's issue — the
	// one whose database id happens to be 1036 — as a blocker, with a 200 and no warning. Sending the
	// issue number is therefore not a near-miss but a silent cross-repository write
	// (joshuafolkken/kit#1026).
	it('resolves the blocker number to its database id before writing', async () => {
		serve_id()

		expect(await git_gh_issue_write.issue_add_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER)).toBe(true)
		expect(request_at(0)).toMatchObject({ path: BLOCKER_PATH, jq_filter: ID_FILTER })
		expect(request_at(1).path).toBe(BLOCKED_BY_PATH)
		expect(parsed_body(request_at(1))).toStrictEqual({ issue_id: BLOCKER_ID })
	})

	it('never sends the blocker issue number as the id', async () => {
		serve_id()
		await git_gh_issue_write.issue_add_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER)

		expect(parsed_body(request_at(1))).not.toStrictEqual({
			issue_id: Number(BLOCKER_NUMBER),
		})
	})

	// `jq` prints an empty line for a field it cannot reach, and `Number('')` is `0` — a value the
	// endpoint would accept.
	it('refuses the write when no database id could be read', async () => {
		serve_id('')

		expect(await git_gh_issue_write.issue_add_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER)).toBe(false)
		expect(requests()).toHaveLength(1)
	})

	it('answers false when the relation write fails', async () => {
		mocked_api
			.mockResolvedValueOnce(String(BLOCKER_ID))
			.mockRejectedValueOnce(new Error(WRITE_FAILED))

		expect(await git_gh_issue_write.issue_add_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER)).toBe(false)
	})
})

describe('issue_remove_blocked_by', () => {
	it('deletes the relation by the blocker database id in the path', async () => {
		serve_id()

		expect(await git_gh_issue_write.issue_remove_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER)).toBe(
			true,
		)
		expect(request_at(1)).toMatchObject({
			path: `${BLOCKED_BY_PATH}/${String(BLOCKER_ID)}`,
			method: 'DELETE',
		})
		expect(request_at(1).body).toBeUndefined()
	})

	it('refuses the delete when no database id could be read', async () => {
		serve_id('null')

		expect(await git_gh_issue_write.issue_remove_blocked_by(ISSUE_NUMBER, BLOCKER_NUMBER)).toBe(
			false,
		)
		expect(requests()).toHaveLength(1)
	})
})
