import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_read as git_gh_issue, NOT_FOUND_STATUS } from './git-gh-issue-read'
import {
	BLOCKER_NUMBER,
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_HTML_URL,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
	rest_blockers,
	rest_issue,
} from './git-gh-issue-rest-fixture'
import { parse_json_object_safe } from './parse-json-array'
import { epic_child_schema, type EpicChildData } from './schemas'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_status = vi.mocked(git_gh_exec.exec_gh_api_status)

const OTHER_REPO = 'joshuafolkken/app-kit'
const CURRENT_REPO_ISSUES = 'repos/{owner}/{repo}/issues'
const ISSUE_PATH = `${CURRENT_REPO_ISSUES}/${String(ISSUE_NUMBER)}`
const BLOCKED_BY_SEGMENT = '/dependencies/blocked_by'
const RATE_LIMITED_STATUS = 429
const RATE_LIMIT_MESSAGE = 'API rate limit exceeded'
const NO_BLOCKERS = '[]'
const READ_NUMBER = String(ISSUE_NUMBER)
const UNKNOWN_NUMBER = '99999'
const OTHER_NUMBER = '431'
const EXACT_TOTAL = 4
const REQUESTS_WITH_RELATIONS = 2
const BLOCKERS = rest_blockers()

// Through the schema the epic readers use, so the assertion is typed and the mapped JSON is proven
// to parse under the shape written for `gh` (joshuafolkken/kit#1024).
function parse_child(json: string | undefined): EpicChildData | undefined {
	return json === undefined ? undefined : parse_json_object_safe(json, epic_child_schema)
}

// `gh api` is asked for the issue and, only when `blockedBy` was requested, for its dependencies.
function serve(issue: string, blockers: string = NO_BLOCKERS): void {
	mocked_api.mockImplementation(async (request) =>
		request.path.includes(BLOCKED_BY_SEGMENT) ? blockers : issue,
	)
}

function api_paths(): Array<string> {
	return mocked_api.mock.calls.map(([request]) => request.path)
}

beforeEach(() => {
	vi.clearAllMocks()
})

// joshuafolkken/kit#1024: `gh issue view` goes through GraphQL, which a cloud session is answered
// 403 for. The failure arrived as `catch { return undefined }`, so an epic whose children could not
// be read looked like an epic with no children and an unattended run ended quietly.
describe('issue_view_json — the request it makes', () => {
	it('reads the issue through gh api rather than gh issue view', async () => {
		serve(rest_issue())

		await git_gh_issue.issue_view_json(READ_NUMBER, 'number,state')

		expect(api_paths()).toEqual([ISSUE_PATH])
	})

	it('reads the named repository when one is given', async () => {
		serve(rest_issue())

		await git_gh_issue.issue_view_json(READ_NUMBER, 'number', OTHER_REPO)

		expect(api_paths()).toEqual([`repos/${OTHER_REPO}/issues/${String(ISSUE_NUMBER)}`])
	})

	it('answers the fields under the names gh answered them with', async () => {
		serve(rest_issue())

		const json = await git_gh_issue.issue_view_json(
			READ_NUMBER,
			'number,state,url,createdAt,labels',
		)

		expect(JSON.parse(json ?? '{}')).toEqual({
			number: ISSUE_NUMBER,
			state: 'OPEN',
			url: ISSUE_HTML_URL,
			createdAt: ISSUE_CREATED_AT,
			labels: [{ name: ISSUE_LABEL }],
		})
	})
})

describe('issue_view_json — the blocked-by relations', () => {
	it('asks the dependencies endpoint when blockedBy was requested', async () => {
		serve(rest_issue(), BLOCKERS)

		await git_gh_issue.issue_view_json(READ_NUMBER, 'number,blockedBy')

		expect(api_paths()[1]).toBe(`${ISSUE_PATH}${BLOCKED_BY_SEGMENT}?per_page=100`)
	})

	it('answers the connection shape the epic readers expect', async () => {
		serve(rest_issue(), BLOCKERS)

		const json = await git_gh_issue.issue_view_json(READ_NUMBER, 'blockedBy')

		expect(JSON.parse(json ?? '{}')).toEqual({
			blockedBy: { nodes: [{ number: BLOCKER_NUMBER, state: 'CLOSED' }], totalCount: 1 },
		})
	})

	// The exact total comes off the issue itself, so `totalCount` keeps meaning what it meant under
	// GraphQL — exact — rather than collapsing to however many the page held.
	it('takes totalCount from the dependency summary when the issue reports one', async () => {
		serve(rest_issue({ issue_dependencies_summary: { total_blocked_by: EXACT_TOTAL } }), BLOCKERS)

		const json = await git_gh_issue.issue_view_json(READ_NUMBER, 'blockedBy')

		expect(parse_child(json)?.blockedBy?.totalCount).toBe(EXACT_TOTAL)
	})
})

// Three of the four field lists in this file do not name `blockedBy`, and `epic:bundle` reads
// relations for the whole open backlog — a second request per issue would double that pass.
describe('issue_view_json — when the dependencies request is made at all', () => {
	it('spends no dependencies request when blockedBy was not requested', async () => {
		serve(rest_issue())

		await git_gh_issue.issue_view_json(READ_NUMBER, 'number,state,labels')

		expect(api_paths()).toEqual([ISSUE_PATH])
	})

	// The issue itself reports the exact count, so an issue with none needs no second request — and
	// relations are read per issue across the whole open backlog, where that doubling would be felt.
	it('spends no dependencies request when the issue reports no blockers', async () => {
		serve(rest_issue({ issue_dependencies_summary: { total_blocked_by: 0 } }), BLOCKERS)

		const json = await git_gh_issue.issue_view_json(READ_NUMBER, 'blockedBy')

		expect(api_paths()).toEqual([ISSUE_PATH])
		expect(parse_child(json)?.blockedBy).toEqual({ nodes: [], totalCount: 0 })
	})

	it('spends no dependencies request for the labels-and-body read', async () => {
		serve(rest_issue())

		await git_gh_issue.issue_get_labels_and_body(READ_NUMBER)

		expect(api_paths()).toEqual([ISSUE_PATH])
	})

	it('asks for the relations on the state-and-relations read', async () => {
		serve(rest_issue(), BLOCKERS)

		await git_gh_issue.issue_get_state_and_relations(READ_NUMBER)

		expect(api_paths()).toHaveLength(REQUESTS_WITH_RELATIONS)
	})
})

// Fail-safe: reporting "no blockers" for a read that failed would let `epic:next` hand a dependent
// to an unattended run before its prerequisite (joshuafolkken/kit#1005).
describe('issue_view_json — a dependencies read that failed', () => {
	it('answers undefined rather than an issue with no blockers', async () => {
		mocked_api.mockImplementation(async (request) =>
			request.path.includes(BLOCKED_BY_SEGMENT)
				? await Promise.reject(new Error(RATE_LIMIT_MESSAGE))
				: await Promise.resolve(rest_issue()),
		)

		await expect(git_gh_issue.issue_view_json(READ_NUMBER, 'blockedBy')).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#957: a read that produced nothing was reported as one the command had failed to
// make, whatever the reason. A number that resolves to nothing is not a gap — reported as one, a
// single typo in an issue body stops an unattended run.
describe('issue_view_json_classified', () => {
	it('returns the json when the read succeeded', async () => {
		serve(rest_issue())

		await expect(git_gh_issue.issue_view_json_classified(READ_NUMBER, 'state')).resolves.toEqual({
			kind: 'read',
			json: '{"state":"OPEN"}',
		})
	})

	// The success path must never spend the extra request: it is the path every ordinary read takes.
	it('spends no status request when the read succeeded', async () => {
		serve(rest_issue())

		await git_gh_issue.issue_view_json_classified(READ_NUMBER, 'state')

		expect(mocked_status).not.toHaveBeenCalled()
	})
})

describe('issue_view_json_classified — telling the two failures apart', () => {
	it('reports a number that resolves to nothing as missing', async () => {
		mocked_api.mockRejectedValueOnce(new Error('Not Found (HTTP 404)'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await expect(git_gh_issue.issue_view_json_classified(UNKNOWN_NUMBER, 'state')).resolves.toEqual(
			{
				kind: 'missing',
			},
		)
	})

	// The distinction is the point: a rate limit is a gap, because the issue may well exist.
	it('reports a rate-limited read as unreadable', async () => {
		mocked_api.mockRejectedValueOnce(new Error(RATE_LIMIT_MESSAGE))
		mocked_status.mockResolvedValueOnce(RATE_LIMITED_STATUS)

		await expect(git_gh_issue.issue_view_json_classified(READ_NUMBER, 'state')).resolves.toEqual({
			kind: 'unreadable',
		})
	})

	// No status at all — gh missing, a dropped connection — is a failed read, not an absent issue.
	it('reports a read with no status at all as unreadable', async () => {
		mocked_api.mockRejectedValueOnce(new Error('connection reset'))
		mocked_status.mockResolvedValueOnce(undefined)

		await expect(git_gh_issue.issue_view_json_classified(READ_NUMBER, 'state')).resolves.toEqual({
			kind: 'unreadable',
		})
	})
})

// The classification is a status code, never `gh`'s wording: a message is prose that can be reworded
// between releases, and a string match on it would silently start answering `unreadable` for every
// missing number. That is why the probe survived the move to REST — `exec_gh_api` surfaces the
// stderr text, not the status.
describe('issue_view_json_classified — what the classification is read from', () => {
	it('classifies by status code rather than by the error text', async () => {
		mocked_api.mockRejectedValueOnce(new Error('some entirely different wording'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await expect(git_gh_issue.issue_view_json_classified(UNKNOWN_NUMBER, 'state')).resolves.toEqual(
			{
				kind: 'missing',
			},
		)
	})

	// A response that is not an issue object is a failed read, not an empty one.
	it('reports output that is not an issue object as unreadable', async () => {
		serve('<html>proxy error</html>')
		mocked_status.mockResolvedValueOnce(RATE_LIMITED_STATUS)

		await expect(git_gh_issue.issue_view_json_classified(READ_NUMBER, 'state')).resolves.toEqual({
			kind: 'unreadable',
		})
	})
})

describe('issue_view_json_classified — which repository it probes', () => {
	it('probes the current repository when no repo is given', async () => {
		mocked_api.mockRejectedValueOnce(new Error('nope'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await git_gh_issue.issue_view_json_classified(UNKNOWN_NUMBER, 'state')

		expect(mocked_status).toHaveBeenCalledWith(`${CURRENT_REPO_ISSUES}/${UNKNOWN_NUMBER}`)
	})

	// A qualified reference reads another repository's issue, so the probe has to follow it there —
	// otherwise the status would describe this repository's issue of that number, a different one.
	it('probes the named repository when one is given', async () => {
		mocked_api.mockRejectedValueOnce(new Error('nope'))
		mocked_status.mockResolvedValueOnce(NOT_FOUND_STATUS)

		await git_gh_issue.issue_view_json_classified(UNKNOWN_NUMBER, 'state', OTHER_REPO)

		expect(mocked_status).toHaveBeenCalledWith(`repos/${OTHER_REPO}/issues/${UNKNOWN_NUMBER}`)
	})
})

// The classification is opt-in. A caller that does not need it must keep costing one request even
// when the read fails, or a rate-limited batch of two hundred reads doubles into four hundred.
describe('issue_view_json — unchanged by the classification', () => {
	it('still answers undefined when the read failed', async () => {
		mocked_api.mockRejectedValueOnce(new Error('nope'))

		await expect(git_gh_issue.issue_view_json(READ_NUMBER, 'state')).resolves.toBeUndefined()
	})

	it('spends no status request when the read failed', async () => {
		mocked_api.mockRejectedValueOnce(new Error('nope'))

		await git_gh_issue.issue_view_json(READ_NUMBER, 'state')

		expect(mocked_status).not.toHaveBeenCalled()
	})

	it('leaves issue_get_state_and_relations answering undefined on a failed read', async () => {
		mocked_api.mockRejectedValueOnce(new Error('nope'))

		await expect(git_gh_issue.issue_get_state_and_relations(READ_NUMBER)).resolves.toBeUndefined()
		expect(mocked_status).not.toHaveBeenCalled()
	})

	it('leaves issue_get_plan_fields answering undefined on a failed read', async () => {
		mocked_api.mockRejectedValueOnce(new Error('nope'))

		await expect(git_gh_issue.issue_get_plan_fields(READ_NUMBER)).resolves.toBeUndefined()
		expect(mocked_status).not.toHaveBeenCalled()
	})
})

describe('issue_get_plan_fields_classified', () => {
	// The path carries no field list under REST, so the parity has to be asserted on the answer:
	// the two must produce the same object, or one of them quietly reads fewer fields.
	it('answers exactly what the unclassified read answers', async () => {
		serve(rest_issue())
		const classified = await git_gh_issue.issue_get_plan_fields_classified(READ_NUMBER)

		serve(rest_issue())
		const plain = await git_gh_issue.issue_get_plan_fields(READ_NUMBER)

		expect(classified).toEqual({ kind: 'read', json: plain })
	})

	// `url` is the field that tells a pull request from an issue (joshuafolkken/kit#947), and the
	// browser URL is the only spelling that carries `/pull/`.
	it('carries the browser url so a pull request stays identifiable', async () => {
		serve(rest_issue())

		await expect(git_gh_issue.issue_get_plan_fields(READ_NUMBER)).resolves.toContain(ISSUE_HTML_URL)
	})
})

// A notification about another repository's issue reads that repository's title. Unqualified, the
// path would name this repository's issue of the same number (joshuafolkken/kit#903).
describe('issue_get_title — which repository it reads', () => {
	it('reads the title from the current repository when no repo is given', async () => {
		serve(rest_issue())

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBe(ISSUE_TITLE)
		expect(api_paths()).toEqual([ISSUE_PATH])
	})

	it('reads the title from the named repository when one is given', async () => {
		serve(rest_issue())

		await git_gh_issue.issue_get_title(OTHER_NUMBER, OTHER_REPO)

		expect(api_paths()).toEqual([`repos/${OTHER_REPO}/issues/${OTHER_NUMBER}`])
	})
})

describe('issue_get_body', () => {
	it('answers the body text', async () => {
		serve(rest_issue())

		await expect(git_gh_issue.issue_get_body(READ_NUMBER)).resolves.toBe(ISSUE_BODY)
	})

	// REST answers JSON null for an issue with no body, where `gh --json body` answered an empty
	// string — and the callers hand this straight on as text.
	it('answers the empty string for an issue with no body', async () => {
		// eslint-disable-next-line unicorn/no-null -- REST answers JSON null for an issue with no body
		serve(rest_issue({ body: null }))

		await expect(git_gh_issue.issue_get_body(READ_NUMBER)).resolves.toBe('')
	})
})

// joshuafolkken/kit#993: the title went through a parser that stripped a leading and trailing `"`,
// on the belief that `gh` wrapped a `--jq`-extracted string. It does not — so the stripping ate a
// real character from any title that carried one, and the notification for such an issue arrived
// with its first or last character missing.
describe('issue_get_title — a quote in the title is data, not JSON wrapping', () => {
	const QUOTED_FIRST_WORD = '"queue" should stop at the first failure'
	const QUOTED_LAST_WORD = 'the flag is called "--merge"'
	const FULLY_QUOTED = '"Close the completion gate"'

	it('keeps a title that starts with a quote', async () => {
		serve(rest_issue({ title: QUOTED_FIRST_WORD }))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBe(QUOTED_FIRST_WORD)
	})

	it('keeps a title that ends with a quote', async () => {
		serve(rest_issue({ title: QUOTED_LAST_WORD }))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBe(QUOTED_LAST_WORD)
	})

	it('keeps a title that both starts and ends with a quote', async () => {
		serve(rest_issue({ title: FULLY_QUOTED }))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBe(FULLY_QUOTED)
	})
})

// The empty answer stays an answer: `undefined` is what tells `josh notify` it has no title to show,
// and that half of the contract is unchanged by the move to REST.
describe('issue_get_title — an empty answer is still not a title', () => {
	it('returns undefined for an empty answer', async () => {
		serve(rest_issue({ title: '' }))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBeUndefined()
	})

	it('returns undefined for a whitespace-only answer', async () => {
		serve(rest_issue({ title: ' '.repeat(3) }))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBeUndefined()
	})

	it('returns undefined when the read itself failed', async () => {
		mocked_api.mockRejectedValueOnce(new Error(RATE_LIMIT_MESSAGE))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBeUndefined()
	})

	it('trims surrounding whitespace off a title', async () => {
		serve(rest_issue({ title: `  ${ISSUE_TITLE}  ` }))

		await expect(git_gh_issue.issue_get_title(READ_NUMBER)).resolves.toBe(ISSUE_TITLE)
	})
})
