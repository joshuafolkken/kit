import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { STATE_AND_RELATIONS_FIELDS, type IssueRead } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_fetch } from './epic-fetch'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const THIRD_REPO = 'joshuafolkken/other'
const OWNER = 'joshuafolkken'
const GET_CHILD = 'issue_get_state_and_relations_classified'
const CHILD_COUNT = 200
const QUERY_COUNT = 2
const BLOCKER = 1

// A child as GraphQL answers it in the batch's alias.
function graphql_node(issue_number: number): object {
	return {
		number: issue_number,
		title: `Child ${String(issue_number)}`,
		state: issue_number === BLOCKER ? 'CLOSED' : 'OPEN',
		body: `Body of ${String(issue_number)}`,
		url: `https://github.com/${REPO}/issues/${String(issue_number)}`,
		createdAt: '2026-11-01T00:00:00Z',
		authorAssociation: 'OWNER',
		author: { login: OWNER, type: 'User' },
		labels: { nodes: [{ name: 'enhancement' }] },
		blockedBy: {
			totalCount: 1,
			nodes: [{ number: BLOCKER, state: 'CLOSED', repository: { nameWithOwner: REPO } }],
		},
	}
}

function graphql_answer(issue_numbers: ReadonlyArray<number>): string {
	const repository = Object.fromEntries(
		issue_numbers.map((issue_number) => [
			`issue${String(issue_number)}`,
			graphql_node(issue_number),
		]),
	)

	return JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4999 }, repository } })
}

// The same child as REST serves it — the oracle the GraphQL mapping has to agree with.
function rest_read(issue_number: string): IssueRead {
	const rest = git_gh_issue_rest.parse_rest_issue(
		JSON.stringify({
			number: Number(issue_number),
			title: `Child ${issue_number}`,
			state: Number(issue_number) === BLOCKER ? 'closed' : 'open',
			body: `Body of ${issue_number}`,
			author_association: 'OWNER',
			user: { login: OWNER },
			labels: [{ name: 'enhancement' }],
			issue_dependencies_summary: { total_blocked_by: 1 },
		}),
	)
	const blocked_by = git_gh_issue_rest.to_blocked_by(
		JSON.stringify([
			{ number: BLOCKER, state: 'closed', repository_url: `https://api.github.com/repos/${REPO}` },
		]),
		1,
	)
	const fields = git_gh_issue_rest.split_fields(STATE_AND_RELATIONS_FIELDS)

	return {
		kind: 'read',
		json: JSON.stringify(git_gh_issue_rest.to_gh_issue(rest, fields, blocked_by)),
	}
}

function numbers_to(count: number): Array<number> {
	return Array.from({ length: count }, (_, index) => index + 1)
}

beforeEach(() => {
	vi.restoreAllMocks()
	mocked_api.mockReset()
	mocked_api.mockImplementation(async () => graphql_answer(numbers_to(CHILD_COUNT)))
	vi.spyOn(git_gh_command, GET_CHILD).mockImplementation(async (number: string) =>
		rest_read(number),
	)
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
})

describe('epic_fetch.fetch_children — read through GraphQL', () => {
	it('reads two hundred children in two queries and no REST read', async () => {
		const fetched = await epic_fetch.fetch_children(numbers_to(CHILD_COUNT), REPO, REPO)

		expect(fetched.children).toHaveLength(CHILD_COUNT)
		expect(mocked_api).toHaveBeenCalledTimes(QUERY_COUNT)
		expect(git_gh_command[GET_CHILD]).not.toHaveBeenCalled()
	})

	it('answers what the REST read answers', async () => {
		const graphql = await epic_fetch.fetch_children(numbers_to(CHILD_COUNT), REPO, REPO)

		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		const rest = await epic_fetch.fetch_children(numbers_to(CHILD_COUNT), REPO, REPO)

		expect(graphql).toEqual(rest)
	})

	it('reads a child the query left unanswered through REST', async () => {
		mocked_api.mockRejectedValue(new Error('timeout'))
		const fetched = await epic_fetch.fetch_children([2, 3], REPO, REPO)

		expect(fetched.children.map((child) => child.number)).toEqual([2, 3])
		expect(git_gh_command[GET_CHILD]).toHaveBeenCalledTimes(2)
	})
})

describe('epic_fetch.fetch_children — a session on REST', () => {
	it('sends no query and reads every child through REST', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		await epic_fetch.fetch_children([2, 3], REPO, REPO)

		expect(mocked_api).not.toHaveBeenCalled()
		expect(git_gh_command[GET_CHILD]).toHaveBeenCalledTimes(2)
	})
})

describe('epic_fetch.fetch_external_children — read through GraphQL', () => {
	it('reads each repository in a query of its own and no REST read', async () => {
		const external = [
			{ repo: OTHER_REPO, number: 2 },
			{ repo: THIRD_REPO, number: 3 },
			{ repo: OTHER_REPO, number: 4 },
		]
		const fetched = await epic_fetch.fetch_external_children(external, OWNER)

		expect(fetched.children.map((child) => [child.repo, child.number])).toEqual([
			[OTHER_REPO, 2],
			[THIRD_REPO, 3],
			[OTHER_REPO, 4],
		])
		expect(mocked_api).toHaveBeenCalledTimes(QUERY_COUNT)
		expect(git_gh_command[GET_CHILD]).not.toHaveBeenCalled()
	})
})
