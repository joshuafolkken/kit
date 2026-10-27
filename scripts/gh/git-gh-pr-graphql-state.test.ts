import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forget_branch_rules } from './git-gh-branch-rules'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_poll_read } from './git-gh-poll-read'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	conditional_read_over,
	find_request,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_detail_path,
	pr_lookup_path,
	pr_reviews_path,
	request_body,
	rest_pull_page,
	status_pages,
	too_many_files_failure,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import { GRAPHQL_PATH, MERGE_STATE_QUERY, NO_MERGE_STATE_MESSAGE } from './git-gh-pr-graphql-state'
import { forget_pr_numbers } from './git-gh-pr-read'
import { pr_get_state_snapshot } from './git-gh-pr-snapshot'
import { evaluate_pr_state } from './git-pr-checks-eval'
import { parse_pr_state_snapshot } from './git-pr-checks-parse'

// joshuafolkken/kit#5229: GitHub refuses some pull requests' single-pull JSON with 422 "too many files
// changed". The listing row stands in, and its missing `mergeable_state` is read from GraphQL — or the
// snapshot throws with the reason, since an unknown state holds the merge gate pending forever.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

vi.mock('./git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_conditional = vi.mocked(git_gh_conditional.read_conditional)

const NODE_ID = 'PR_node_of_a_large_pull'
const PASSING_RUN = { name: 'SonarQube', status: 'completed', conclusion: 'success' }
const CLEAN_ANSWER = JSON.stringify({ data: { node: { mergeStateStatus: 'CLEAN' } } })
const NO_STATE_ANSWER = JSON.stringify({ data: { node: {} } })

async function refuse_graphql(): Promise<string> {
	throw gh_failure()
}

interface TooLargeInput {
	graphql: GhApiAnswer
	detail_failure?: Error
	node_id?: string | undefined
}

function stub_too_large(input: TooLargeInput): void {
	const failure = input.detail_failure ?? too_many_files_failure()
	const row = { node_id: 'node_id' in input ? input.node_id : NODE_ID }
	const routes: Record<string, GhApiAnswer> = {
		[pr_lookup_path()]: rest_pull_page([row]),
		[pr_detail_path()]: async () => {
			throw failure
		},
		[GRAPHQL_PATH]: input.graphql,
		[commit_check_runs_path()]: check_runs_pages([PASSING_RUN]),
		[commit_status_path()]: status_pages([]),
		[pr_reviews_path()]: '[]',
	}

	mocked_api.mockImplementation(gh_api_routes(routes))
}

function asked_graphql(): boolean {
	return mocked_api.mock.calls.some(([request]) => request.path === GRAPHQL_PATH)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_conditional.mockImplementation(conditional_read_over(mocked_api))
	forget_pr_numbers()
	forget_branch_rules()
	git_gh_poll_read.forget_poll_reads()
})

describe('pr_get_state_snapshot — a detail refused as too many files changed', () => {
	it('reads mergeStateStatus from GraphQL, which lets a clean pull request reach success', async () => {
		stub_too_large({ graphql: CLEAN_ANSWER })
		const json = await pr_get_state_snapshot(PR_BRANCH)
		const snapshot = parse_pr_state_snapshot(json)

		expect(snapshot.merge_state_status).toBe('CLEAN')
		expect(evaluate_pr_state(snapshot)).toBe('success')
	})

	it('asks GraphQL for the listing row node', async () => {
		stub_too_large({ graphql: CLEAN_ANSWER })
		await pr_get_state_snapshot(PR_BRANCH)
		const requests = mocked_api.mock.calls.map(([request]) => request)
		const graphql_request = find_request(requests, GRAPHQL_PATH)

		expect(request_body(graphql_request)).toStrictEqual({
			query: MERGE_STATE_QUERY,
			variables: { id: NODE_ID },
		})
	})
})

describe('pr_get_state_snapshot — no merge state to judge from', () => {
	it.each<[string, TooLargeInput]>([
		['GraphQL is refused', { graphql: refuse_graphql }],
		['GraphQL answers no state', { graphql: NO_STATE_ANSWER }],
		['the row has no node_id', { graphql: CLEAN_ANSWER, node_id: undefined }],
	])('throws with the reason when %s', async (_label, input) => {
		stub_too_large(input)

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toThrow(NO_MERGE_STATE_MESSAGE)
	})

	it('keeps any other detail failure as it was, without asking GraphQL', async () => {
		const failure = gh_failure()

		stub_too_large({ graphql: CLEAN_ANSWER, detail_failure: failure })

		await expect(pr_get_state_snapshot(PR_BRANCH)).rejects.toBe(failure)
		expect(asked_graphql()).toBe(false)
	})
})
