import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { PICKUP_FIELDS } from './git-gh-issue'
import { git_gh_issue_list } from './git-gh-issue-list'
import {
	graphql_issue_node,
	graphql_labels,
	graphql_listing,
	OWNER_ASSOCIATION,
	OWNER_LOGIN,
} from './git-gh-issue-list-graphql-fixture'
import {
	BLOCKED_BY_SEGMENT,
	BLOCKER_NUMBER,
	ISSUE_NUMBER,
	rest_issue_page,
} from './git-gh-issue-rest-fixture'
import { GRAPHQL_PATH, TRANSPORT_ENV_VAR } from './git-gh-transport'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

// The page reads go through `exec_gh_api` here, so every REST request is one counted call.
vi.mock('./git-gh-etag-read', async () => {
	const { git_gh_etag_read_fixture } = await import('./git-gh-etag-read-fixture')

	return { git_gh_etag_read: git_gh_etag_read_fixture.through_exec }
})

// joshuafolkken/kit#6785: on a session GraphQL is allowed for, the `backlog:next` pool — the
// `auto-ok` listing and each row's blockers — is one GraphQL query and no REST core request. The
// REST listing is the oracle: the same backlog served both ways answers the same JSON.

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const AUTO_OK = 'auto-ok'
const LIMIT = 50
const LIMIT_ONE = 1
const BLOCKED_NUMBER = 900
const REPO = 'joshuafolkken/kit'

interface BacklogRow {
	number: number
	blocker_state?: string
}

const BACKLOG: ReadonlyArray<BacklogRow> = [
	{ number: BLOCKED_NUMBER, blocker_state: 'closed' },
	{ number: ISSUE_NUMBER },
]

function html_url_of(number: number): string {
	return `https://github.com/${REPO}/issues/${String(number)}`
}

function blocker_count(row: BacklogRow): number {
	return row.blocker_state === undefined ? 0 : 1
}

function rest_row(row: BacklogRow): Record<string, unknown> {
	return {
		number: row.number,
		html_url: html_url_of(row.number),
		author_association: OWNER_ASSOCIATION,
		user: { login: OWNER_LOGIN },
		labels: [{ name: AUTO_OK }],
		issue_dependencies_summary: { total_blocked_by: blocker_count(row) },
	}
}

function graphql_blockers(row: BacklogRow): Array<Record<string, unknown>> {
	if (row.blocker_state === undefined) return []

	const state = row.blocker_state.toUpperCase()

	return [{ number: BLOCKER_NUMBER, state, repository: { nameWithOwner: REPO } }]
}

function graphql_node(row: BacklogRow): Record<string, unknown> {
	return graphql_issue_node({
		number: row.number,
		url: html_url_of(row.number),
		labels: graphql_labels([AUTO_OK]),
		blockedBy: { totalCount: blocker_count(row), nodes: graphql_blockers(row) },
	})
}

function backlog_listing(has_next_page = false): string {
	return graphql_listing(
		BACKLOG.map((row) => graphql_node(row)),
		has_next_page,
	)
}

function rest_blockers(): string {
	const repository_url = `https://api.github.com/repos/${REPO}`

	return JSON.stringify([{ number: BLOCKER_NUMBER, state: 'closed', repository_url }])
}

function rest_answer(path: string): string {
	return path.includes(BLOCKED_BY_SEGMENT)
		? rest_blockers()
		: rest_issue_page(BACKLOG.map((row) => rest_row(row)))
}

// `is_graphql_up` false answers the query the way `gh` does on a failure: a non-zero exit.
function serve_backlog(is_graphql_up = true, has_next_page = false): void {
	mocked_api.mockImplementation(async (request: GhApiRequest) => {
		if (request.path !== GRAPHQL_PATH) return rest_answer(request.path)
		if (!is_graphql_up) throw new Error('gh exited 1')

		return backlog_listing(has_next_page)
	})
}

function graphql_reads(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === GRAPHQL_PATH).length
}

function rest_reads(): number {
	return mocked_api.mock.calls.length - graphql_reads()
}

async function pool_json(json_fields = PICKUP_FIELDS, limit = LIMIT): Promise<string | undefined> {
	const outcome = await git_gh_issue_list.issue_list({ json_fields, limit, label: AUTO_OK })

	return outcome.json
}

async function rest_pool_json(): Promise<string | undefined> {
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	const json = await pool_json()

	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')

	return json
}

beforeEach(() => {
	mocked_api.mockReset()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
	serve_backlog()
})

describe('issue_list — the pool in one GraphQL query', () => {
	it('reads the pool and its blockers in one query and no REST request', async () => {
		await pool_json()

		expect([graphql_reads(), rest_reads()]).toEqual([1, 0])
	})

	it('asks for the label the listing filters on', async () => {
		await pool_json()

		const body = JSON.parse(mocked_api.mock.calls[0]?.[0].body ?? '{}') as unknown

		expect(body).toMatchObject({ variables: { labels: [AUTO_OK] } })
	})

	it('answers the same JSON as the REST listing', async () => {
		const through_rest = await rest_pool_json()

		expect(through_rest).toBeDefined()
		expect(await pool_json()).toBe(through_rest)
	})

	// A next page left unread: the rows already selected fill the limit, so REST is not asked.
	it('cuts the listing off at limit without reading REST', async () => {
		serve_backlog(true, true)
		const json = await pool_json('number', LIMIT_ONE)

		expect(json).toBe(JSON.stringify([{ number: BLOCKED_NUMBER }]))
		expect(rest_reads()).toBe(0)
	})
})

describe('issue_list — the pool handed back to REST', () => {
	it('sends no query on a REST session', async () => {
		await rest_pool_json()

		expect(graphql_reads()).toBe(0)
	})

	it('reads REST when the query fails, answering the same JSON', async () => {
		const through_rest = await rest_pool_json()

		serve_backlog(false)

		expect(await pool_json()).toBe(through_rest)
	})

	it('reads REST when one page does not answer the caller', async () => {
		serve_backlog(true, true)
		await pool_json()

		expect(rest_reads()).toBeGreaterThan(0)
	})

	// Each case moves one of the two off the open, newest-first listing the query answers.
	it.each([
		['closed', 'created'],
		['open', 'updated'],
	] as const)('keeps a %s listing sorted by %s on REST', async (state, sort) => {
		await git_gh_issue_list.issue_list({
			json_fields: 'number,title,labels',
			limit: LIMIT,
			state,
			sort,
		})

		expect(graphql_reads()).toBe(0)
	})

	it('keeps a listing asking for a field GraphQL does not carry on REST', async () => {
		await pool_json('number,stateReason')

		expect(graphql_reads()).toBe(0)
	})
})
