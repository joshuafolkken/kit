import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_blocked_by_graphql, IDS_PER_QUERY } from './git-gh-blocked-by-graphql'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_issue_rest, type RestIssue } from './git-gh-issue-rest'
import { REFUSED_MESSAGE, TRANSPORT_ENV_VAR } from './git-gh-transport'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const BLOCKER_NUMBER = 1023
const BLOCKER_REPO = 'joshuafolkken/kit'
const SUMMARY_TOTAL = 3
const FIRST_NUMBER = 1
const FORBIDDEN_STATUS = 403

function row(number: number, overrides: Partial<RestIssue> = {}): RestIssue {
	return {
		number,
		node_id: `I_${String(number)}`,
		issue_dependencies_summary: { total_blocked_by: 1 },
		...overrides,
	}
}

function rows_of(count: number): Array<RestIssue> {
	return Array.from({ length: count }, (_, index) => row(index + FIRST_NUMBER))
}

function ids_of(request: GhApiRequest): Array<string> {
	const body: unknown = JSON.parse(request.body ?? '{}')
	const { variables } = body as { variables: { ids: Array<string> } }

	return variables.ids
}

function issue_node(id: string): Record<string, unknown> {
	const blocker = {
		number: BLOCKER_NUMBER,
		state: 'OPEN',
		repository: { nameWithOwner: BLOCKER_REPO },
	}

	return { id, blockedBy: { nodes: [blocker] } }
}

// Every id the query names resolves, except those in `unresolved`, which answer `null`.
function serve_nodes(unresolved: ReadonlyArray<string> = []): void {
	mocked_api.mockImplementation(async (request) => {
		const nodes = ids_of(request).map((id) =>
			// eslint-disable-next-line unicorn/no-null -- GraphQL answers null for an unresolved id
			unresolved.includes(id) ? null : issue_node(id),
		)

		return await JSON.stringify({ data: { nodes } })
	})
}

beforeEach(() => {
	mocked_api.mockReset()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('read_answered — one GraphQL query per hundred rows', () => {
	it('reads a page and a half of rows in two queries', async () => {
		serve_nodes()
		const rows = rows_of(IDS_PER_QUERY + IDS_PER_QUERY / 2)

		const answered = await git_gh_blocked_by_graphql.read_answered(rows)

		expect(mocked_api).toHaveBeenCalledTimes(2)
		expect(answered.size).toBe(rows.length)
	})

	it('maps a blocker node to the REST shape with its repository URL', async () => {
		serve_nodes()
		const only = row(FIRST_NUMBER)

		const answered = await git_gh_blocked_by_graphql.read_answered([only])
		const blocked_by = answered.get(only)

		expect(blocked_by?.nodes).toEqual([
			{
				number: BLOCKER_NUMBER,
				state: 'OPEN',
				repository_url: `https://api.github.com/repos/${BLOCKER_REPO}`,
			},
		])
		expect(git_gh_issue_rest.repo_of_url(blocked_by?.nodes[0]?.repository_url)).toBe(BLOCKER_REPO)
	})

	it('takes totalCount from the row summary rather than the page length', async () => {
		serve_nodes()
		const summarized = row(FIRST_NUMBER, {
			issue_dependencies_summary: { total_blocked_by: SUMMARY_TOTAL },
		})

		const answered = await git_gh_blocked_by_graphql.read_answered([summarized])

		expect(answered.get(summarized)?.totalCount).toBe(SUMMARY_TOTAL)
	})
})

describe('read_answered — rows left to REST', () => {
	it('answers no row when the query fails', async () => {
		mocked_api.mockRejectedValue(new Error('gh exited 1'))

		const answered = await git_gh_blocked_by_graphql.read_answered(rows_of(2))

		expect(answered.size).toBe(0)
	})
})

describe('read_answered — the session transport', () => {
	it('sends no query and answers no row on a REST session', async () => {
		serve_nodes()
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')

		const answered = await git_gh_blocked_by_graphql.read_answered(rows_of(2))

		expect([mocked_api.mock.calls.length, answered.size]).toEqual([0, 0])
	})

	it('stops with its reason when a GraphQL session is refused', async () => {
		mocked_api.mockRejectedValue(
			gh_failure.attach(new Error('forbidden'), { status: FORBIDDEN_STATUS }),
		)
		vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')

		await expect(git_gh_blocked_by_graphql.read_answered(rows_of(2))).rejects.toThrow(
			REFUSED_MESSAGE,
		)
	})
})

describe('read_answered — rows left unresolved', () => {
	it('leaves an unresolved node unanswered and answers the rest', async () => {
		const unresolved = row(FIRST_NUMBER)
		const resolved = row(2)

		serve_nodes([unresolved.node_id ?? ''])
		const answered = await git_gh_blocked_by_graphql.read_answered([unresolved, resolved])

		expect([answered.has(unresolved), answered.has(resolved)]).toEqual([false, true])
	})

	it('sends no query for a row without a node_id, with a zero summary or a pull request', async () => {
		serve_nodes()
		const rows = [
			row(FIRST_NUMBER, { node_id: undefined }),
			row(2, { issue_dependencies_summary: { total_blocked_by: 0 } }),
			row(3, { issue_dependencies_summary: undefined, pull_request: {} }),
		]

		const answered = await git_gh_blocked_by_graphql.read_answered(rows)

		expect([mocked_api.mock.calls.length, answered.size]).toEqual([0, 0])
	})
})
