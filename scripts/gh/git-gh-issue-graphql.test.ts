import { afterEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_issue_read, type IssueWithComments } from './git-gh-issue-read'
import {
	BLOCKED_BY_SEGMENT,
	BLOCKER_NUMBER,
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_HTML_URL,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
} from './git-gh-issue-rest-fixture'
import { GRAPHQL_PATH, REFUSED_MESSAGE, TRANSPORT_ENV_VAR } from './git-gh-transport'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_status: vi.fn() },
}))

vi.mock('./git-gh-etag-read', () => ({
	git_gh_etag_read: { read: async (path: string) => await git_gh_exec.exec_gh_api({ path }) },
}))

// `issue_read_with_comments` — one issue's fields and comments from one GraphQL query, or from the
// REST reads it replaces when that query is refused (joshuafolkken/kit#6722). The two paths have to
// answer the same thing, so every case below is the same issue served both ways.

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO = 'joshuafolkken/kit'
const READ_NUMBER = String(ISSUE_NUMBER)
const FIELDS = 'number,title,state,body,url,createdAt,labels,blockedBy,author_association,user'
const FORBIDDEN_STATUS = 403
const COMMENTS_SEGMENT = '/comments'
const AUTHOR = 'someone'
const ASSOCIATION = 'OWNER'
const COMMENT_URL = `${ISSUE_HTML_URL}#issuecomment-1`
const COMMENT_BODY = 'A comment'
const BOT = 'renovate'
const REPOSITORY_API_URL = `https://api.github.com/repos/${REPO}`
const USER_AUTHOR = { login: AUTHOR, type: 'User' }
// eslint-disable-next-line unicorn/no-null -- GraphQL answers null for a deleted account or a missing issue
const NOTHING = null

function graphql_comment(author: unknown = USER_AUTHOR): unknown {
	return {
		url: COMMENT_URL,
		body: COMMENT_BODY,
		createdAt: ISSUE_CREATED_AT,
		authorAssociation: ASSOCIATION,
		author,
	}
}

function graphql_issue(overrides: Record<string, unknown> = {}): string {
	const issue = {
		number: ISSUE_NUMBER,
		title: ISSUE_TITLE,
		state: 'OPEN',
		body: ISSUE_BODY,
		url: ISSUE_HTML_URL,
		createdAt: ISSUE_CREATED_AT,
		authorAssociation: ASSOCIATION,
		author: USER_AUTHOR,
		labels: { nodes: [{ name: ISSUE_LABEL }] },
		blockedBy: {
			totalCount: 1,
			nodes: [{ number: BLOCKER_NUMBER, state: 'CLOSED', repository: { nameWithOwner: REPO } }],
		},
		comments: { pageInfo: { hasNextPage: false }, nodes: [graphql_comment()] },
		...overrides,
	}

	return JSON.stringify({ data: { repository: { issue } } })
}

// The same issue as the REST endpoints serve it.
const REST_ISSUE = JSON.stringify({
	number: ISSUE_NUMBER,
	title: ISSUE_TITLE,
	state: 'open',
	body: ISSUE_BODY,
	html_url: ISSUE_HTML_URL,
	created_at: ISSUE_CREATED_AT,
	author_association: ASSOCIATION,
	user: { login: AUTHOR },
	labels: [{ name: ISSUE_LABEL }],
	issue_dependencies_summary: { total_blocked_by: 1 },
})
const REST_BLOCKERS = JSON.stringify([
	{ number: BLOCKER_NUMBER, state: 'closed', repository_url: REPOSITORY_API_URL },
])
const REST_COMMENTS = JSON.stringify([
	{
		html_url: COMMENT_URL,
		body: COMMENT_BODY,
		created_at: ISSUE_CREATED_AT,
		author_association: ASSOCIATION,
		user: { login: AUTHOR },
	},
])

function rest_answer(path: string): string {
	if (path.includes(BLOCKED_BY_SEGMENT)) return REST_BLOCKERS

	return path.includes(COMMENTS_SEGMENT) ? REST_COMMENTS : REST_ISSUE
}

// `graphql` answers the GraphQL request — a string, or the error it fails with.
function serve(graphql: string | Error): void {
	mocked_api.mockReset()
	mocked_api.mockImplementation(async (request: GhApiRequest) => {
		if (request.path !== GRAPHQL_PATH) return rest_answer(request.path)
		if (graphql instanceof Error) throw graphql

		return graphql
	})
}

function api_paths(): Array<string> {
	return mocked_api.mock.calls.map(([request]) => request.path)
}

function parsed(answer: IssueWithComments): { issue: unknown; comments: unknown } {
	const json = answer.read.kind === 'read' ? answer.read.json : '{}'

	return { issue: JSON.parse(json), comments: JSON.parse(answer.comments_json ?? '[]') }
}

async function read(repo: string = REPO): Promise<IssueWithComments> {
	return await git_gh_issue_read.issue_read_with_comments(READ_NUMBER, FIELDS, repo)
}

// A session on REST: GraphQL would answer, and is never asked.
async function read_through_rest(): Promise<IssueWithComments> {
	serve(graphql_issue())
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')

	const answer = await read()

	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')

	return answer
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('issue_read_with_comments — one GraphQL query', () => {
	it('reads the fields and the comments in one GraphQL request and no REST request', async () => {
		serve(graphql_issue())

		const answer = await read()

		expect(api_paths()).toStrictEqual([GRAPHQL_PATH])
		expect(answer.read.kind).toBe('read')
		expect(parsed(answer).comments).toStrictEqual(JSON.parse(REST_COMMENTS))
	})

	it('answers exactly what the REST reads answer on a REST session, which sends no GraphQL', async () => {
		serve(graphql_issue())
		const through_graphql = parsed(await read())

		const through_rest = await read_through_rest()

		expect(api_paths()).toContain(`repos/${REPO}/issues/${READ_NUMBER}`)
		expect(api_paths()).not.toContain(GRAPHQL_PATH)
		expect(parsed(through_rest)).toStrictEqual(through_graphql)
	})

	it('stops with its reason when a GraphQL session is refused', async () => {
		serve(gh_failure.attach(new Error('forbidden'), { status: FORBIDDEN_STATUS }))
		vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')

		await expect(read()).rejects.toThrow(REFUSED_MESSAGE)
		expect(api_paths()).toStrictEqual([GRAPHQL_PATH])
	})

	it('maps the blockers and the counts the way the REST reads do', async () => {
		serve(graphql_issue())

		const { issue } = parsed(await read())

		expect(issue).toMatchObject({
			state: 'OPEN',
			labels: [{ name: ISSUE_LABEL }],
			blockedBy: { totalCount: 1, nodes: [{ number: BLOCKER_NUMBER, state: 'CLOSED' }] },
		})
	})
})

describe('issue_read_with_comments — handing the read back to REST', () => {
	it('falls back when GraphQL answers an errors document with no issue', async () => {
		serve(JSON.stringify({ data: { repository: { issue: NOTHING } }, errors: [{ message: 'no' }] }))

		const answer = await read()

		expect(api_paths().length).toBeGreaterThan(1)
		expect(parsed(answer)).toStrictEqual(parsed(await read_through_rest()))
	})

	it('falls back when the comments run past one page', async () => {
		serve(graphql_issue({ comments: { pageInfo: { hasNextPage: true }, nodes: [] } }))

		const answer = await read()

		expect(parsed(answer).comments).toStrictEqual(JSON.parse(REST_COMMENTS))
	})

	it('asks GraphQL nothing for a repository it cannot name', async () => {
		serve(graphql_issue())

		await read('not-a-repository')

		expect(api_paths()).not.toContain(GRAPHQL_PATH)
	})
})

describe('issue_read_with_comments — authors', () => {
	it('spells a bot login as REST does and leaves a deleted author out', async () => {
		const comments = [graphql_comment({ login: BOT, type: 'Bot' }), graphql_comment(NOTHING)]

		serve(graphql_issue({ comments: { pageInfo: { hasNextPage: false }, nodes: comments } }))

		const answer = parsed(await read()).comments

		expect(answer).toMatchObject([{ user: { login: `${BOT}[bot]` } }, {}])
		expect(answer).not.toMatchObject([{}, { user: expect.anything() }])
	})
})
