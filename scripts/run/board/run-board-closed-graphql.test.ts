import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import { issue_merged } from '#scripts/issue/issue-merged'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_closed } from './run-board-closed'

// joshuafolkken/kit#6791: the run's closed children in one GraphQL query, answered as the REST reads
// answer them — the REST path is the oracle.

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const ISSUE = 6791
const OPEN_ISSUE = 6792
const TITLE = 'Read run:board child state'
const CLOSED_AT = '2026-11-08T14:58:42Z'
const MERGED_AT = '2026-11-08T14:50:00Z'

interface Scenario {
	name: string
	state_reason: string | undefined
	graphql_events: ReadonlyArray<object>
	rest_events: ReadonlyArray<object>
}

const MERGED_REFERENCE = {
	graphql: { type: 'CrossReferencedEvent', source: { mergedAt: MERGED_AT } },
	rest: {
		event: 'cross-referenced',
		source: { issue: { pull_request: { merged_at: MERGED_AT } } },
	},
}

const MERGED: Scenario = {
	name: 'closed by a merged pull request',
	state_reason: 'completed',
	graphql_events: [MERGED_REFERENCE.graphql, { type: 'ClosedEvent', stateReason: 'COMPLETED' }],
	rest_events: [MERGED_REFERENCE.rest, { event: 'closed', state_reason: 'completed' }],
}

const BY_HAND: Scenario = {
	name: 'closed by hand',
	state_reason: 'completed',
	graphql_events: [{ type: 'ClosedEvent', stateReason: 'COMPLETED' }],
	rest_events: [{ event: 'closed', state_reason: 'completed' }],
}

const SCENARIOS: ReadonlyArray<Scenario> = [
	MERGED,
	{
		name: 'withdrawn as not planned',
		state_reason: 'not_planned',
		graphql_events: [MERGED_REFERENCE.graphql, { type: 'ClosedEvent', stateReason: 'NOT_PLANNED' }],
		rest_events: [MERGED_REFERENCE.rest, { event: 'closed', state_reason: 'not_planned' }],
	},
	BY_HAND,
	{
		name: 'measured, then closed',
		state_reason: 'completed',
		graphql_events: [
			{ type: 'LabeledEvent', label: { name: 'measured' } },
			{ type: 'ClosedEvent', stateReason: 'COMPLETED' },
		],
		rest_events: [
			{ event: 'labeled', label: { name: 'measured' } },
			{ event: 'closed', state_reason: 'completed' },
		],
	},
	{
		name: 'merged, then reopened',
		state_reason: undefined,
		graphql_events: [
			MERGED_REFERENCE.graphql,
			{ type: 'ClosedEvent', stateReason: 'COMPLETED' },
			{ type: 'ReopenedEvent' },
		],
		rest_events: [
			MERGED_REFERENCE.rest,
			{ event: 'closed', state_reason: 'completed' },
			{ event: 'reopened' },
		],
	},
]

function graphql_issue(scenario: Scenario, has_next_page = false): object {
	return {
		title: TITLE,
		state: 'CLOSED',
		stateReason: scenario.state_reason?.toUpperCase(),
		closedAt: CLOSED_AT,
		labels: { nodes: [{ name: 'enhancement' }] },
		timelineItems: { pageInfo: { hasNextPage: has_next_page }, nodes: scenario.graphql_events },
	}
}

function open_issue(): object {
	return {
		title: TITLE,
		state: 'OPEN',
		labels: { nodes: [] },
		timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] },
	}
}

function graphql_answer(issues: Readonly<Record<number, object>>): string {
	const repository = Object.fromEntries(
		Object.entries(issues).map(([issue, node]) => [`issue${issue}`, node]),
	)

	return JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4999 }, repository } })
}

function serve_rest(scenario: Scenario): void {
	vi.spyOn(git_gh_issue_read, 'issue_view_json').mockResolvedValue(
		JSON.stringify({
			title: TITLE,
			state: 'CLOSED',
			stateReason: scenario.state_reason,
			closedAt: CLOSED_AT,
			labels: [{ name: 'enhancement' }],
		}),
	)
	vi.spyOn(git_gh_etag_read, 'read').mockResolvedValue(JSON.stringify(scenario.rest_events))
}

beforeEach(() => {
	vi.restoreAllMocks()
	mocked_api.mockReset()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
})

describe('run_board_closed.read_all — the GraphQL read', () => {
	it('reads a tick of children in one query and no REST core', async () => {
		const view = vi.spyOn(git_gh_issue_read, 'issue_view_json')
		const merge = vi.spyOn(issue_merged, 'read_merge_state')
		const etag = vi.spyOn(git_gh_etag_read, 'read')

		mocked_api.mockResolvedValue(
			graphql_answer({ [ISSUE]: graphql_issue(MERGED), [OPEN_ISSUE]: open_issue() }),
		)

		const answer = await run_board_closed.read_all([ISSUE, OPEN_ISSUE])

		expect([...answer.closed.keys()]).toStrictEqual([ISSUE])
		expect(answer.is_whole).toBe(true)
		expect(mocked_api).toHaveBeenCalledTimes(1)
		expect([view, merge, etag].map((spy) => spy.mock.calls.length)).toStrictEqual([0, 0, 0])
	})

	it.each(SCENARIOS)('answers $name as the REST read does', async (scenario) => {
		mocked_api.mockResolvedValue(graphql_answer({ [ISSUE]: graphql_issue(scenario) }))
		const graphql = await run_board_closed.read_all([ISSUE])

		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		serve_rest(scenario)
		const rest = await run_board_closed.read_all([ISSUE])

		expect(graphql).toStrictEqual(rest)
	})

	it('reads a timeline past one page through REST, and only it', async () => {
		const view = vi.spyOn(git_gh_issue_read, 'issue_view_json')
		const merge = vi.spyOn(issue_merged, 'read_merge_state').mockResolvedValue(true)

		mocked_api.mockResolvedValue(graphql_answer({ [ISSUE]: graphql_issue(BY_HAND, true) }))

		const answer = await run_board_closed.read_all([ISSUE])

		expect(answer.closed.get(ISSUE)?.is_merged).toBe(true)
		expect(merge).toHaveBeenCalledWith(String(ISSUE))
		expect(view).not.toHaveBeenCalled()
	})
})
