import { open_issue_schema } from '#scripts/git/git-schemas'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_list } from './git-gh-issue-list'
import { is_listing_query } from './git-gh-issue-list-graphql-fixture'
import { git_gh_issue_memo } from './git-gh-issue-memo'
import {
	BLOCKED_BY_SEGMENT,
	BLOCKER_NUMBER,
	ISSUE_NUMBER,
	rest_blockers,
	rest_dependencies_summary,
	rest_issue_page,
} from './git-gh-issue-rest-fixture'
import { GRAPHQL_PATH } from './git-gh-pr-graphql-state'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

// The page reads go through `exec_gh_api` here; the ETag is pinned in `git-gh-issue-list-etag.test.ts`.
vi.mock('./git-gh-etag-read', async () => {
	const { git_gh_etag_read_fixture } = await import('./git-gh-etag-read-fixture')

	return { git_gh_etag_read: git_gh_etag_read_fixture.through_exec }
})

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

beforeEach(() => {
	git_gh_issue_memo.forget()
})

const PICKUP_FIELDS = 'number,title,labels,createdAt,blockedBy'
const SECOND_NUMBER = 900
const LIMIT_ONE = 1
const LIMIT_MANY = 50
const SLOW_READ_MS = 20
const BOTH_ROWS = 2

interface Flight {
	current: number
	peak: number
}

// joshuafolkken/kit#3103: the relations are read concurrently, so the first request to start is not
// the first to finish. The first row's read is held back so it lands last, and `flight` records how
// many relation reads were in progress at once.
function serve_blockers_out_of_order(): Flight {
	const flight: Flight = { current: 0, peak: 0 }

	mocked_api.mockImplementation(async (request) => {
		if (!request.path.includes(BLOCKED_BY_SEGMENT)) {
			return rest_issue_page([
				{ number: ISSUE_NUMBER, ...rest_dependencies_summary(LIMIT_ONE) },
				{ number: SECOND_NUMBER, ...rest_dependencies_summary(LIMIT_ONE) },
			])
		}

		const is_first = request.path.includes(`/${String(ISSUE_NUMBER)}/`)

		flight.current += 1
		flight.peak = Math.max(flight.peak, flight.current)
		await new Promise((resolve) => setTimeout(resolve, is_first ? SLOW_READ_MS : 0))
		flight.current -= 1

		return rest_blockers(is_first ? 'closed' : 'open')
	})

	return flight
}

// joshuafolkken/kit#6634: rows carrying a `node_id` are read in one GraphQL query. The blocker is
// served by both transports in their own spelling, so a listing read either way can be compared.
const BLOCKER_REPO = 'joshuafolkken/kit'
const REST_BLOCKER_STATE = 'closed'
const GRAPHQL_BLOCKER_STATE = 'CLOSED'
const MANY_ROWS = 30

function node_id_of(number: number): string {
	return `I_${String(number)}`
}

function blocked_rows(count: number): Array<Record<string, unknown>> {
	return Array.from({ length: count }, (_, index) => ({
		number: ISSUE_NUMBER + index,
		node_id: node_id_of(ISSUE_NUMBER + index),
		...rest_dependencies_summary(LIMIT_ONE),
	}))
}

function graphql_answer(body = '{}'): string {
	const { variables } = JSON.parse(body) as { variables: { ids: Array<string> } }
	const blocker = {
		number: BLOCKER_NUMBER,
		state: GRAPHQL_BLOCKER_STATE,
		repository: { nameWithOwner: BLOCKER_REPO },
	}

	return JSON.stringify({
		data: { nodes: variables.ids.map((id) => ({ id, blockedBy: { nodes: [blocker] } })) },
	})
}

function rest_blocker_answer(): string {
	const repository_url = `https://api.github.com/repos/${BLOCKER_REPO}`

	return JSON.stringify([{ number: BLOCKER_NUMBER, state: REST_BLOCKER_STATE, repository_url }])
}

// `is_graphql_up` false answers the query the way `gh` does on a failure: a non-zero exit. The
// listing query always fails here, so the listing is REST's — as for a backlog one GraphQL page
// cannot hold (joshuafolkken/kit#6785) — and what these pin is the blocker reads that follow it.
function serve_listing(rows: ReadonlyArray<Record<string, unknown>>, is_graphql_up: boolean): void {
	mocked_api.mockImplementation(async (request) => {
		if (request.path === GRAPHQL_PATH) {
			if (!is_graphql_up || is_listing_query(request.body)) throw new Error('gh exited 1')

			return graphql_answer(request.body)
		}

		return await (request.path.includes(BLOCKED_BY_SEGMENT)
			? rest_blocker_answer()
			: rest_issue_page(rows))
	})
}

function blocked_by_reads(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path.includes(BLOCKED_BY_SEGMENT))
		.length
}

function graphql_reads(): number {
	return mocked_api.mock.calls.filter(
		([request]) => request.path === GRAPHQL_PATH && !is_listing_query(request.body),
	).length
}

async function listing_json(): Promise<string | undefined> {
	const outcome = await git_gh_issue_list.issue_list({
		json_fields: PICKUP_FIELDS,
		limit: LIMIT_MANY,
	})

	return outcome.json
}

describe('issue_list — blocker relations in one GraphQL query', () => {
	beforeEach(() => {
		mocked_api.mockReset()
	})

	it('reads thirty blocked rows in one query and no REST blocker read', async () => {
		serve_listing(blocked_rows(MANY_ROWS), true)

		await listing_json()

		expect([graphql_reads(), blocked_by_reads()]).toEqual([1, 0])
	})

	it('reads every row through REST when the query fails', async () => {
		serve_listing(blocked_rows(BOTH_ROWS), false)

		const json = await listing_json()
		const rows = parse_json_array_or_undefined(json ?? '', open_issue_schema)

		expect(blocked_by_reads()).toBe(BOTH_ROWS)
		expect(rows?.map((row) => row.blockedBy?.nodes[0]?.state)).toEqual([
			GRAPHQL_BLOCKER_STATE,
			GRAPHQL_BLOCKER_STATE,
		])
	})

	// What `backlog:next` ranks and holds on is this listing: the same JSON either way is the same
	// order and the same wait / retry verdicts.
	it('answers the same listing as the REST reads did', async () => {
		serve_listing(blocked_rows(BOTH_ROWS), true)
		const through_graphql = await listing_json()

		serve_listing(blocked_rows(BOTH_ROWS), false)
		const through_rest = await listing_json()

		expect(through_graphql).toBe(through_rest)
	})
})

describe('issue_list — concurrent blocker relations', () => {
	it('keeps each row paired with its own blockers when the reads finish out of order', async () => {
		serve_blockers_out_of_order()

		const outcome = await git_gh_issue_list.issue_list({
			json_fields: PICKUP_FIELDS,
			limit: LIMIT_MANY,
		})
		const rows = parse_json_array_or_undefined(outcome.json ?? '', open_issue_schema)

		expect(rows?.map((row) => row.blockedBy?.nodes[0]?.state)).toEqual(['CLOSED', 'OPEN'])
	})

	it('starts the second read before the first one has finished', async () => {
		const flight = serve_blockers_out_of_order()

		await git_gh_issue_list.issue_list({ json_fields: PICKUP_FIELDS, limit: LIMIT_MANY })

		expect(flight.peak).toBe(BOTH_ROWS)
	})
})
