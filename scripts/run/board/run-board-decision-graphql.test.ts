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
// as the REST reads answer them — the REST path is the oracle.

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

function plan_of(): BoardPlan {
	const children = [child(WAITING, [MIDDLE]), child(MIDDLE, [PERSON]), child(STALLED, [OUTSIDE])]

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
