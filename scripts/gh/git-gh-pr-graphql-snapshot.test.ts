import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { forget_branch_rules } from './git-gh-branch-rules'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_poll_read } from './git-gh-poll-read'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	conditional_read_over,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	PR_HEAD_SHA,
	PR_NUMBER,
	pr_reviews_path,
	pr_routes,
	request_body,
	status_pages,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import {
	CONTEXTS_PAGE_QUERY,
	git_gh_pr_graphql_snapshot,
	REVIEW_DECISION_QUERY,
	SNAPSHOT_QUERY,
} from './git-gh-pr-graphql-snapshot'
import { forget_pr_numbers } from './git-gh-pr-read'
import {
	pr_get_checks_snapshot,
	pr_get_review_decision,
	pr_get_state_snapshot,
} from './git-gh-pr-snapshot'
import { GRAPHQL_PATH, TRANSPORT_ENV_VAR } from './git-gh-transport'
import { parse_pr_state_snapshot } from './git-pr-checks-parse'

// joshuafolkken/kit#6786: where the session's transport allows GraphQL, the merge gate's snapshot is
// one query rather than the REST lookup, detail, check-run, status, review and branch-rule reads —
// and it must read exactly as the REST snapshot does, since `pnpm josh followup` merges on it.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

vi.mock('./git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_conditional = vi.mocked(git_gh_conditional.read_conditional)

const TYPE_NAME = '__typename'
const COMMIT_ID = 'C_head_commit_node'
const BASE_BRANCH = 'main'
const SONAR_QUBE = 'SonarQube'
const E2E = 'E2E'
const CODE_RABBIT = 'CodeRabbit'
const NEXT_CURSOR = 'cursor-after-the-first-page'
const REVIEWING = 'Review in progress'

type GraphqlNode = Record<string, unknown>

function check_run_node(name: string, status: string, conclusion?: string): GraphqlNode {
	return { [TYPE_NAME]: 'CheckRun', name, status, conclusion: conclusion ?? JSON.parse('null') }
}

const ACTIONS_APP = 15_368
const ACTIONS_SLUG = 'github-actions'

function suite_run_node(conclusion: string, suite: number, run: number): GraphqlNode {
	const check_suite = { databaseId: suite, app: { databaseId: ACTIONS_APP, slug: ACTIONS_SLUG } }

	return {
		...check_run_node(E2E, 'COMPLETED', conclusion),
		databaseId: run,
		checkSuite: check_suite,
	}
}

function status_node(context: string, state: string): GraphqlNode {
	return { [TYPE_NAME]: 'StatusContext', context, state, description: REVIEWING }
}

function contexts_page(nodes: ReadonlyArray<GraphqlNode>, end_cursor?: string): GraphqlNode {
	return { pageInfo: { hasNextPage: end_cursor !== undefined, endCursor: end_cursor }, nodes }
}

const PASSING_NODES = [check_run_node(SONAR_QUBE, 'COMPLETED', 'SUCCESS')]

function graphql_pull(
	overrides: GraphqlNode = {},
	page = contexts_page(PASSING_NODES),
): GraphqlNode {
	const required = { requiredStatusChecks: [{ context: SONAR_QUBE }] }

	return {
		number: PR_NUMBER,
		isCrossRepository: false,
		merged: false,
		mergeStateStatus: 'CLEAN',
		reviewDecision: 'APPROVED',
		baseRef: { rules: { nodes: [{ type: 'REQUIRED_STATUS_CHECKS', parameters: required }] } },
		commits: {
			nodes: [
				{ commit: { id: COMMIT_ID, oid: PR_HEAD_SHA, statusCheckRollup: { contexts: page } } },
			],
		},
		...overrides,
	}
}

const RATE_LIMIT = { cost: 1, remaining: 4999 }

function snapshot_answer(pull?: GraphqlNode): string {
	const pull_requests = { nodes: pull === undefined ? [] : [pull] }

	return JSON.stringify({
		data: { rateLimit: RATE_LIMIT, repository: { pullRequests: pull_requests } },
	})
}

function page_answer(page: GraphqlNode): string {
	const node = { statusCheckRollup: { contexts: page } }

	return JSON.stringify({ data: { rateLimit: RATE_LIMIT, node } })
}

function decision_answer(decision: string): string {
	return JSON.stringify({ data: { repository: { pullRequest: { reviewDecision: decision } } } })
}

// GraphQL answers on one path, so the router picks the answer by the query the body carries.
function graphql_route(answers: Record<string, string>): GhApiAnswer {
	return async (request: GhApiRequest) => {
		const answer = answers[String(request_body(request)['query'])]
		if (answer === undefined) throw gh_failure()

		return answer
	}
}

function stub_graphql(
	answers: Record<string, string>,
	rest: Record<string, GhApiAnswer> = {},
): void {
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
	mocked_api.mockImplementation(gh_api_routes({ ...rest, [GRAPHQL_PATH]: graphql_route(answers) }))
}

function rest_calls(): Array<string> {
	const paths = mocked_api.mock.calls.map(([request]) => request.path)

	return [...paths, ...mocked_conditional.mock.calls.map(([path]) => path)].filter(
		(path) => path !== GRAPHQL_PATH,
	)
}

function graphql_variables(): Array<unknown> {
	return mocked_api.mock.calls
		.filter(([request]) => request.path === GRAPHQL_PATH)
		.map(([request]) => request_body(request)['variables'])
}

// The REST answers of the same pull request `graphql_pull` describes.
function rest_routes(): Record<string, GhApiAnswer> {
	const rules = [
		{
			type: 'required_status_checks',
			parameters: { required_status_checks: [{ context: SONAR_QUBE }] },
		},
	]
	const rules_path = `${git_gh_api_path.branch_rules_api_path(BASE_BRANCH)}${FULL_PAGE_QUERY}`

	return pr_routes(
		{ mergeable_state: 'clean', base: { ref: BASE_BRANCH } },
		{
			[commit_check_runs_path()]: check_runs_pages([
				{ name: SONAR_QUBE, status: 'completed', conclusion: 'success' },
				{ name: E2E, status: 'in_progress', conclusion: JSON.parse('null') },
			]),
			[commit_status_path()]: status_pages([
				{ context: CODE_RABBIT, state: 'pending', description: REVIEWING },
			]),
			[pr_reviews_path()]: JSON.stringify([{ state: 'APPROVED', user: { login: 'alice' } }]),
			[rules_path]: JSON.stringify(rules),
		},
	)
}

const MIXED_NODES = [
	status_node(CODE_RABBIT, 'PENDING'),
	check_run_node(SONAR_QUBE, 'COMPLETED', 'SUCCESS'),
	check_run_node(E2E, 'IN_PROGRESS'),
]
const MIXED_ANSWER = snapshot_answer(graphql_pull({}, contexts_page(MIXED_NODES)))
const PAGED_ANSWER = snapshot_answer(graphql_pull({}, contexts_page(PASSING_NODES, NEXT_CURSOR)))
// PR #2717's shape: the older suite's run was cancelled, the newer suite's passed.
const NEWER_SUITE = { suite: 2, run: 20 }
const TWO_SUITE_NODES = [
	suite_run_node('SUCCESS', NEWER_SUITE.suite, NEWER_SUITE.run),
	suite_run_node('CANCELLED', 1, 30),
]
// GitHub leaves `reviewDecision` unset where the base branch requires no review.
const UNSET_DECISION_ANSWER = snapshot_answer(graphql_pull({ reviewDecision: JSON.parse('null') }))
const CHANGE_REQUEST = { state: 'CHANGES_REQUESTED', user: { login: 'bob' } }
const TWO_SUITE_ANSWER = snapshot_answer(graphql_pull({}, contexts_page(TWO_SUITE_NODES)))

beforeEach(() => {
	mocked_api.mockReset()
	mocked_conditional.mockReset()
	mocked_conditional.mockImplementation(conditional_read_over(mocked_api))
	forget_pr_numbers()
	forget_branch_rules()
	git_gh_poll_read.forget_poll_reads()
})

describe('pr_get_state_snapshot — one GraphQL query', () => {
	it('reads a cold snapshot without one REST core request', async () => {
		stub_graphql({ [SNAPSHOT_QUERY]: snapshot_answer(graphql_pull()) })

		const snapshot = parse_pr_state_snapshot(await pr_get_state_snapshot(PR_BRANCH))

		expect(rest_calls()).toEqual([])
		expect(mocked_api).toHaveBeenCalledOnce()
		expect(snapshot).toMatchObject({ merge_state_status: 'CLEAN', head_sha: PR_HEAD_SHA })
		expect(snapshot.required_contexts).toEqual([SONAR_QUBE])
	})

	it('answers the same snapshot the REST path answers for the same pull request', async () => {
		stub_graphql({ [SNAPSHOT_QUERY]: MIXED_ANSWER })
		const graphql_json = await pr_get_state_snapshot(PR_BRANCH)

		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		mocked_api.mockImplementation(gh_api_routes(rest_routes()))
		const rest_json = await pr_get_state_snapshot(PR_BRANCH)

		expect(Object.keys(JSON.parse(graphql_json) as object)).toEqual(
			Object.keys(JSON.parse(rest_json) as object),
		)
		expect(parse_pr_state_snapshot(graphql_json)).toEqual(parse_pr_state_snapshot(rest_json))
	})

	it('reads the next page of a full rollup rather than handing the read to REST', async () => {
		const second = check_run_node(E2E, 'COMPLETED', 'FAILURE')

		stub_graphql({
			[SNAPSHOT_QUERY]: PAGED_ANSWER,
			[CONTEXTS_PAGE_QUERY]: page_answer(contexts_page([second])),
		})

		const read = await git_gh_pr_graphql_snapshot.read_snapshot(PR_BRANCH)

		expect(rest_calls()).toEqual([])
		expect(graphql_variables()).toContainEqual({ id: COMMIT_ID, after: NEXT_CURSOR })
		expect(read?.fields['statusCheckRollup']).toHaveLength(2)
		expect(read?.rate_limit).toEqual({ cost: 2, remaining: RATE_LIMIT.remaining })
	})
})

describe('pr_get_state_snapshot — check runs of more than one check suite', () => {
	// The app's slug is what `followup-job-rerun.ts` reads to rerun a GitHub Actions job a 5xx
	// download failed: without it no failed job qualifies.
	it("keeps only the newest check suite's run of a name, as the REST rollup does", async () => {
		stub_graphql({ [SNAPSHOT_QUERY]: TWO_SUITE_ANSWER })

		const read = await git_gh_pr_graphql_snapshot.read_snapshot(PR_BRANCH)

		expect(read?.fields['statusCheckRollup']).toStrictEqual([
			{
				id: NEWER_SUITE.run,
				check_suite: { id: NEWER_SUITE.suite },
				app: { id: ACTIONS_APP, slug: ACTIONS_SLUG },
				name: E2E,
				status: 'completed',
				conclusion: 'success',
			},
		])
	})
})

describe('pr_get_state_snapshot — the review decision and merged state from GraphQL', () => {
	it.each([
		['REVIEW_REQUIRED', ''],
		['CHANGES_REQUESTED', 'CHANGES_REQUESTED'],
	])('answers a %s review decision as the REST fold does', async (decision, expected) => {
		stub_graphql({ [SNAPSHOT_QUERY]: snapshot_answer(graphql_pull({ reviewDecision: decision })) })

		const json = await pr_get_state_snapshot(PR_BRANCH)

		expect(JSON.parse(json)).toMatchObject({ reviewDecision: expected })
	})

	it('reads a standing change request from REST where GraphQL leaves the decision unset', async () => {
		stub_graphql(
			{ [SNAPSHOT_QUERY]: UNSET_DECISION_ANSWER },
			{ [pr_reviews_path()]: JSON.stringify([CHANGE_REQUEST]) },
		)

		const json = await pr_get_state_snapshot(PR_BRANCH)

		expect(new Set(rest_calls())).toEqual(new Set([pr_reviews_path()]))
		expect(JSON.parse(json)).toMatchObject({ reviewDecision: 'CHANGES_REQUESTED' })
	})

	it('carries merged only once the pull request is in', async () => {
		stub_graphql({ [SNAPSHOT_QUERY]: snapshot_answer(graphql_pull({ merged: true })) })

		const { snapshot_json } = await pr_get_checks_snapshot(PR_BRANCH)

		expect(JSON.parse(snapshot_json)).toMatchObject({ merged: true })
		expect(snapshot_json).not.toContain('reviewDecision')
	})
})

describe('pr_get_state_snapshot — handed back to REST', () => {
	it.each([
		['the query fails', {}],
		['the branch has no pull request', { [SNAPSHOT_QUERY]: snapshot_answer() }],
		[
			'the pull request is from a fork',
			{ [SNAPSHOT_QUERY]: snapshot_answer(graphql_pull({ isCrossRepository: true })) },
		],
	])('reads REST where %s', async (_label, answers: Record<string, string>) => {
		stub_graphql(answers, rest_routes())

		const snapshot = parse_pr_state_snapshot(await pr_get_state_snapshot(PR_BRANCH))

		expect(rest_calls()).not.toEqual([])
		expect(snapshot.required_contexts).toEqual([SONAR_QUBE])
	})
})

describe('pr_get_state_snapshot — a REST session', () => {
	it('sends no GraphQL on a REST session and answers the snapshot byte for byte as before', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		mocked_api.mockImplementation(gh_api_routes(rest_routes()))

		const json = await pr_get_state_snapshot(PR_BRANCH)

		expect(graphql_variables()).toEqual([])
		expect(json).toBe(
			JSON.stringify({
				statusCheckRollup: [
					{ name: SONAR_QUBE, status: 'completed', conclusion: 'success' },
					{ name: E2E, status: 'in_progress', conclusion: JSON.parse('null') },
					{
						context: CODE_RABBIT,
						state: 'pending',
						description: REVIEWING,
						[TYPE_NAME]: 'StatusContext',
					},
				],
				mergeStateStatus: 'CLEAN',
				headRefOid: PR_HEAD_SHA,
				requiredContexts: [SONAR_QUBE],
				reviewDecision: 'APPROVED',
			}),
		)
	})
})

describe('pr_get_review_decision — GraphQL', () => {
	it('reads the decision without the REST review listing', async () => {
		stub_graphql({ [REVIEW_DECISION_QUERY]: decision_answer('CHANGES_REQUESTED') })

		await expect(pr_get_review_decision(PR_NUMBER)).resolves.toBe('CHANGES_REQUESTED')
		expect(rest_calls()).toEqual([])
	})
})
