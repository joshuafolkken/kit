import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { rest_issue } from '#scripts/gh/git-gh-issue-rest-fixture'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import { NEEDS_DECISION_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_decision_read } from './run-board-decision-read'
import type { BoardPlan } from './run-board-layout'

// joshuafolkken/kit#6819: the decision walk's nodes outside the plan in one GraphQL query, answered
// as the REST reads answer them — the REST path is the oracle. joshuafolkken/kit#6857 moves the
// `needs-decision` children's comment read the same way.

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO = 'joshuafolkken/kit'
const WAITING = 6108
const MIDDLE = 6048
const PERSON = 6113
const STALLED = 6120
const OUTSIDE = 6121
const UPSTREAM = 6122
const ISSUE_PATH = /issues\/(\d+)/u
const BLOCKED_BY_SEGMENT = '/dependencies/blocked_by'

interface Node {
	title: string
	body: string
	labels: ReadonlyArray<string>
	blockers: ReadonlyArray<number>
}

// The two nodes outside the plan: a person's decision, and a plain issue that is blocked itself.
const NODES: ReadonlyMap<number, Node> = new Map([
	[
		PERSON,
		{
			title: 'Confirm the promotional credits',
			body: '- 人の判断: 要（外部アカウント）',
			labels: [NEEDS_DECISION_LABEL],
			blockers: [],
		},
	],
	[OUTSIDE, { title: 'Wait for the upstream release', body: '', labels: [], blockers: [UPSTREAM] }],
])

function node_of(number: number): Node {
	const node = NODES.get(number)

	if (node === undefined) throw new Error(`No fixture node #${String(number)}`)

	return node
}

function child(number: number, blockers: ReadonlyArray<number>): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: blockers.map((blocker) => ({ repo: REPO, number: blocker, state: 'OPEN' })),
	}
}

function plan_of(deciding: ReadonlyArray<EpicChild> = []): BoardPlan {
	const children = [
		child(WAITING, [MIDDLE]),
		child(MIDDLE, [PERSON]),
		child(STALLED, [OUTSIDE]),
		...deciding,
	]

	return {
		waves: { waves: [], unreached: children },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([WAITING, MIDDLE, STALLED]) },
		labels: new Map(children.map((node) => [node.number, node.labels])),
		withheld: new Set([WAITING, MIDDLE, STALLED]),
	}
}

function graphql_node(number: number, node: Node): object {
	return {
		number,
		title: node.title,
		state: 'OPEN',
		body: node.body,
		url: `https://github.com/${REPO}/issues/${String(number)}`,
		createdAt: '2026-11-08T09:00:00Z',
		authorAssociation: 'OWNER',
		author: { login: 'joshuafolkken', type: 'User' },
		labels: { nodes: node.labels.map((name) => ({ name })) },
		blockedBy: {
			totalCount: node.blockers.length,
			nodes: node.blockers.map((blocker) => ({
				number: blocker,
				state: 'OPEN',
				repository: { nameWithOwner: REPO },
			})),
		},
	}
}

function graphql_answer(numbers: ReadonlyArray<number>): string {
	const repository = Object.fromEntries(
		numbers.map((number) => [`issue${String(number)}`, graphql_node(number, node_of(number))]),
	)

	return JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4999 }, repository } })
}

function rest_answer(path: string): string {
	const number = Number(ISSUE_PATH.exec(path)?.[1])
	const node = node_of(number)

	if (path.includes(BLOCKED_BY_SEGMENT)) {
		return JSON.stringify(
			node.blockers.map((blocker) => ({
				number: blocker,
				state: 'open',
				repository_url: `https://api.github.com/repos/${REPO}`,
			})),
		)
	}

	return rest_issue({
		number,
		title: node.title,
		body: node.body,
		labels: node.labels.map((name) => ({ name })),
		issue_dependencies_summary: { total_blocked_by: node.blockers.length },
	})
}

function serve_rest(): void {
	vi.spyOn(git_gh_etag_read, 'read').mockImplementation(async (path) => await rest_answer(path))
}

// joshuafolkken/kit#6857: a `needs-decision` child of the plan, whose comments carry its question.
const DECIDING = 6130
const QUESTION = 'Which account pays for the credits?'
const COMMENT_URL = `https://github.com/${REPO}/issues/${String(DECIDING)}#issuecomment-1`
const COMMENT_BODY = `## ${QUESTION}\n\nneeds-decision`
const COMMENT_TIME = '2026-11-09T09:00:00Z'
const COMMENT_FIELDS = 'comments('

function deciding_plan(): BoardPlan {
	return plan_of([{ ...child(DECIDING, []), labels: [NEEDS_DECISION_LABEL] }])
}

function graphql_comments(has_next_page: boolean): string {
	const comment = {
		url: COMMENT_URL,
		body: COMMENT_BODY,
		createdAt: COMMENT_TIME,
		authorAssociation: 'OWNER',
		author: { login: 'joshuafolkken', type: 'User' },
	}
	const comments = { pageInfo: { hasNextPage: has_next_page }, nodes: [comment] }
	const repository = { [`issue${String(DECIDING)}`]: { comments } }

	return JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4999 }, repository } })
}

// The REST listing's spelling of the same comment — the oracle the GraphQL mapping answers.
const REST_COMMENTS = JSON.stringify([
	{
		html_url: COMMENT_URL,
		body: COMMENT_BODY,
		created_at: COMMENT_TIME,
		author_association: 'OWNER',
		user: { login: 'joshuafolkken' },
	},
])

// The node query and the comment query, told apart by the comment connection the latter asks for.
function serve_graphql(has_next_page = false): void {
	mocked_api.mockImplementation(async ({ body }) => {
		const answer = body?.includes(COMMENT_FIELDS)
			? graphql_comments(has_next_page)
			: graphql_answer([PERSON, OUTSIDE])

		return await answer
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	mocked_api.mockReset()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
})

describe('run_board_decision_read.with_decisions — the GraphQL read', () => {
	it('reads every node outside the plan in one query and no REST core (ac-8d57cb9a)', async () => {
		mocked_api.mockResolvedValue(graphql_answer([PERSON, OUTSIDE]))
		const view = vi.spyOn(git_gh_issue_read, 'issue_view_json')
		const read = vi.spyOn(git_gh_etag_read, 'read')

		const plan = await run_board_decision_read.with_decisions(plan_of())

		expect(plan?.decision_waits?.size).toBe(3)
		expect(mocked_api).toHaveBeenCalledOnce()
		expect(view).not.toHaveBeenCalled()
		expect(read).not.toHaveBeenCalled()
	})

	it('answers what the REST path answers (ac-520dfbd0)', async () => {
		mocked_api.mockResolvedValue(graphql_answer([PERSON, OUTSIDE]))
		const graphql = await run_board_decision_read.with_decisions(plan_of())

		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		serve_rest()
		const rest = await run_board_decision_read.with_decisions(plan_of())

		expect(graphql).toStrictEqual(rest)
	})

	it('reads a node GraphQL left unanswered through REST', async () => {
		mocked_api.mockResolvedValue(graphql_answer([PERSON]))
		serve_rest()
		const view = vi.spyOn(git_gh_issue_read, 'issue_view_json')

		await run_board_decision_read.with_decisions(plan_of())

		expect(view.mock.calls.map(([number]) => number)).toStrictEqual([String(OUTSIDE)])
	})

	it('sends no GraphQL request in a REST session', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		serve_rest()

		await run_board_decision_read.with_decisions(plan_of())

		expect(mocked_api).not.toHaveBeenCalled()
	})
})

describe('run_board_decision_read.with_decisions — the GraphQL comment read', () => {
	it('reads the nodes and the decision comments with no REST core (ac-c6f8921e)', async () => {
		serve_graphql()
		const view = vi.spyOn(git_gh_issue_read, 'issue_view_json')
		const comments = vi.spyOn(git_gh_issue_read, 'issue_list_comments')
		const read = vi.spyOn(git_gh_etag_read, 'read')

		const plan = await run_board_decision_read.with_decisions(deciding_plan())

		expect(plan?.decision_questions?.get(DECIDING)).toBe(QUESTION)
		expect(mocked_api).toHaveBeenCalledTimes(2)
		expect(view).not.toHaveBeenCalled()
		expect(comments).not.toHaveBeenCalled()
		expect(read).not.toHaveBeenCalled()
	})

	it('answers the comment question the REST listing answers (ac-ce447068)', async () => {
		serve_graphql()
		const graphql = await run_board_decision_read.with_decisions(deciding_plan())

		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		serve_rest()
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue(REST_COMMENTS)
		const rest = await run_board_decision_read.with_decisions(deciding_plan())

		expect(graphql?.decision_questions).toStrictEqual(rest?.decision_questions)
		expect(graphql?.decision_questions?.size).toBe(1)
	})
})

describe('run_board_decision_read.with_decisions — the REST comment read', () => {
	it('reads a listing GraphQL cut at the page through REST', async () => {
		serve_graphql(true)
		const comments = vi
			.spyOn(git_gh_issue_read, 'issue_list_comments')
			.mockResolvedValue(REST_COMMENTS)

		await run_board_decision_read.with_decisions(deciding_plan())

		expect(comments.mock.calls.map(([number]) => number)).toStrictEqual([String(DECIDING)])
	})

	it('sends no comment query in a REST session (ac-f5d6bd56)', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		serve_rest()
		const comments = vi
			.spyOn(git_gh_issue_read, 'issue_list_comments')
			.mockResolvedValue(REST_COMMENTS)

		await run_board_decision_read.with_decisions(deciding_plan())

		expect(mocked_api).not.toHaveBeenCalled()
		expect(comments).toHaveBeenCalledOnce()
	})
})
