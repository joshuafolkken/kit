import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { git_gh_issue_graphql, PAGE } from './git-gh-issue-graphql'
import { REVIEW_APPROVED, REVIEW_CHANGES_REQUESTED, REVIEW_NONE } from './git-gh-pr-review'
import { git_gh_pr_rollup } from './git-gh-pr-rollup'
import { git_gh_transport } from './git-gh-transport'

// The merge gate's snapshot in one GraphQL query where the session's transport allows it
// (joshuafolkken/kit#6786): the pull request of a branch, its merge state, review decision, the head
// commit's `statusCheckRollup` and the base branch's required checks — the lookup, detail, check-run,
// status, review and branch-rule reads the REST path spends core quota on.
//
// **The answer is spelled the way the REST path spells it** (`git-gh-pr-snapshot.ts`): check runs then
// status contexts, the newest check suite's run of each name, lower-case enums, `merged` only once
// true, and a review decision of `APPROVED`, `CHANGES_REQUESTED` or the empty string.
// `parse_pr_state_snapshot` reads both alike.
//
// **`undefined` hands the read back to REST**: a session on REST (`git-gh-transport.ts`), a failed
// query or page, a repository the checkout cannot name, a branch with no pull request (REST then
// throws with its reason), a pull request from a fork, or a head with no commit.
//
// The rollup's contexts are a nested connection: a full page is followed by the next one, read from the
// head commit's node, rather than handed to REST.

const TYPE_NAME_KEY = '__typename'
const CHECK_RUN = 'CheckRun'
const STATUS_CONTEXT = 'StatusContext'
const REQUIRED_STATUS_CHECKS = 'REQUIRED_STATUS_CHECKS'

const CONTEXTS = `contexts(${PAGE}, after: $after) {
	pageInfo { hasNextPage endCursor }
	nodes {
		__typename
		... on ${CHECK_RUN} {
			databaseId name status conclusion checkSuite { databaseId app { databaseId slug } }
		}
		... on ${STATUS_CONTEXT} { context state description }
	}
}`

const REQUIRED_CHECKS = `rules(${PAGE}) {
	nodes { type parameters { ... on RequiredStatusChecksParameters { requiredStatusChecks { context } } } }
}`

const SNAPSHOT_QUERY = `query($owner: String!, $name: String!, $branch: String!, $after: String) {
	rateLimit { cost remaining }
	repository(owner: $owner, name: $name) {
		pullRequests(headRefName: $branch, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
			nodes {
				number isCrossRepository merged mergeStateStatus reviewDecision
				baseRef { ${REQUIRED_CHECKS} }
				commits(last: 1) { nodes { commit { id oid statusCheckRollup { ${CONTEXTS} } } } }
			}
		}
	}
}`

const CONTEXTS_PAGE_QUERY = `query($id: ID!, $after: String) {
	rateLimit { cost remaining }
	node(id: $id) { ... on Commit { statusCheckRollup { ${CONTEXTS} } } }
}`

const REVIEW_DECISION_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewDecision } }
}`

const rate_limit_schema = z.object({ cost: z.number(), remaining: z.number() })
const database_id_schema = z.number().nullish()
const app_schema = z
	.looseObject({ databaseId: database_id_schema, slug: z.string().nullish() })
	.nullish()
const check_suite_schema = z.looseObject({ databaseId: database_id_schema, app: app_schema })
const check_run_schema = z.looseObject({
	[TYPE_NAME_KEY]: z.literal(CHECK_RUN),
	databaseId: database_id_schema,
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	checkSuite: check_suite_schema.nullish(),
})
const status_context_schema = z.looseObject({
	[TYPE_NAME_KEY]: z.literal(STATUS_CONTEXT),
	context: z.string(),
	state: z.string(),
	description: z.string().nullable(),
})
const context_schema = z.discriminatedUnion(TYPE_NAME_KEY, [
	check_run_schema,
	status_context_schema,
])
const page_info_schema = z.looseObject({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullish(),
})
const contexts_page_schema = z.looseObject({
	pageInfo: page_info_schema,
	nodes: z.array(context_schema),
})
const rollup_schema = z.looseObject({ contexts: contexts_page_schema }).nullable()
const commit_schema = z.looseObject({
	id: z.string(),
	oid: z.string(),
	statusCheckRollup: rollup_schema,
})
const commit_node_schema = z.looseObject({ commit: commit_schema })
const commits_schema = z.looseObject({ nodes: z.array(commit_node_schema) })
const required_check_schema = z.looseObject({ context: z.string() })
const rule_parameters_schema = z.looseObject({
	requiredStatusChecks: z.array(required_check_schema).optional(),
})
const rule_schema = z.looseObject({
	type: z.string(),
	parameters: rule_parameters_schema.nullable(),
})
const rules_schema = z.looseObject({ nodes: z.array(rule_schema) })
const base_reference_schema = z.looseObject({ rules: rules_schema })
const pull_schema = z.looseObject({
	number: z.number(),
	isCrossRepository: z.boolean(),
	merged: z.boolean(),
	mergeStateStatus: z.string(),
	reviewDecision: z.string().nullable(),
	baseRef: base_reference_schema.nullable(),
	commits: commits_schema,
})
const pull_requests_schema = z.looseObject({ nodes: z.array(pull_schema) })
const snapshot_data_schema = z.looseObject({
	rateLimit: rate_limit_schema,
	repository: z.looseObject({ pullRequests: pull_requests_schema }),
})
const page_data_schema = z.looseObject({
	rateLimit: rate_limit_schema,
	node: z.looseObject({ statusCheckRollup: rollup_schema }),
})
const decision_pull_schema = z.looseObject({ reviewDecision: z.string().nullable() })
const decision_data_schema = z.looseObject({
	repository: z.looseObject({ pullRequest: decision_pull_schema }),
})

type RateLimit = z.infer<typeof rate_limit_schema>
type RollupContext = z.infer<typeof context_schema>
type CheckApp = z.infer<typeof app_schema>
type ContextsPage = z.infer<typeof contexts_page_schema>
type GraphqlPull = z.infer<typeof pull_schema>

// The snapshot's fields bar the review decision, which travels beside them as the REST path's
// `pr_get_review_decision` does (`undefined` where GraphQL has none to give), and what the queries
// cost: `cost` sums every page's points, `remaining` is the GraphQL budget the last one left.
interface GraphqlSnapshot {
	pr_number: number
	fields: Record<string, unknown>
	review_decision: string | undefined
	rate_limit: RateLimit
}

interface PageRead {
	page: ContextsPage
	rate_limit: RateLimit
}

interface ContextsRead {
	contexts: Array<RollupContext>
	rate_limit: RateLimit
}

interface AnsweredPull {
	pull: GraphqlPull
	rate_limit: RateLimit
}

const EMPTY_PAGE: ContextsPage = { pageInfo: { hasNextPage: false }, nodes: [] }

const DECISIONS = new Set([REVIEW_APPROVED, REVIEW_CHANGES_REQUESTED])

async function query_data<T>(
	query: string,
	variables: Record<string, unknown>,
	schema: z.ZodType<T>,
): Promise<T | undefined> {
	const json = await git_gh_transport.query({ query, variables })
	if (json === undefined) return undefined

	return json_value.parse_with(json, z.looseObject({ data: schema }))?.data
}

function page_of(rollup: z.infer<typeof rollup_schema>): ContextsPage {
	return rollup?.contexts ?? EMPTY_PAGE
}

function spent_on(previous: RateLimit, next: RateLimit): RateLimit {
	return { cost: previous.cost + next.cost, remaining: next.remaining }
}

async function read_next_page(
	commit_id: string,
	after: string | null | undefined,
): Promise<PageRead | undefined> {
	const data = await query_data(CONTEXTS_PAGE_QUERY, { id: commit_id, after }, page_data_schema)

	return data && { page: page_of(data.node.statusCheckRollup), rate_limit: data.rateLimit }
}

function joined(page: ContextsPage, rest: ContextsRead | undefined): ContextsRead | undefined {
	return rest && { contexts: [...page.nodes, ...rest.contexts], rate_limit: rest.rate_limit }
}

async function read_pages_from(
	commit_id: string,
	read: PageRead,
): Promise<ContextsRead | undefined> {
	const { page, rate_limit } = read
	if (!page.pageInfo.hasNextPage) return { contexts: page.nodes, rate_limit }

	const next = await read_next_page(commit_id, page.pageInfo.endCursor)
	if (next === undefined) return undefined

	const spent = spent_on(rate_limit, next.rate_limit)

	return joined(page, await read_pages_from(commit_id, { page: next.page, rate_limit: spent }))
}

// REST answers an unfinished run's `conclusion` as `null`, kept as it came rather than dropped.
function lower_case_of(value: string | null): string | null {
	return value === null ? value : value.toLowerCase()
}

function to_rest_context(context: RollupContext): Record<string, unknown> {
	if (context.__typename === STATUS_CONTEXT) {
		const { context: name, state, description } = context

		return {
			[TYPE_NAME_KEY]: STATUS_CONTEXT,
			context: name,
			state: state.toLowerCase(),
			description,
		}
	}

	const { name, status, conclusion } = context

	return { name, status: status.toLowerCase(), conclusion: lower_case_of(conclusion) }
}

// An `{ id }` holder, as REST nests one, or nothing where GraphQL has no database id.
function id_holder_of(database_id: number | null | undefined): { id: number } | undefined {
	return database_id === null || database_id === undefined ? undefined : { id: database_id }
}

// The app as REST nests it: its id, which `newest_check_runs` ranks by, and its slug, which
// `followup-job-rerun.ts` reads to tell a GitHub Actions job it may rerun.
function to_rest_app(app: CheckApp): Record<string, unknown> | undefined {
	if (app === null || app === undefined) return undefined

	const holder = id_holder_of(app.databaseId)
	if (holder === undefined) return undefined

	return { ...holder, slug: app.slug ?? undefined }
}

// The ids `newest_check_runs` ranks a run by, spelled as REST nests them.
function to_rest_ids(context: RollupContext): Record<string, unknown> {
	if (context.__typename === STATUS_CONTEXT) return {}

	const suite = context.checkSuite

	return {
		...id_holder_of(context.databaseId),
		check_suite: id_holder_of(suite?.databaseId),
		app: to_rest_app(suite?.app),
	}
}

// Check runs first, then status contexts, as the REST path merges its two endpoints. The rollup holds
// a run from every check suite, so only the newest suite's run of a name is kept, as REST keeps it.
function to_rest_rollup(contexts: ReadonlyArray<RollupContext>): Array<Record<string, unknown>> {
	const check_runs = contexts
		.filter((context) => context.__typename === CHECK_RUN)
		.map((context) => ({ ...to_rest_ids(context), ...to_rest_context(context) }))
	const statuses = contexts
		.filter((context) => context.__typename === STATUS_CONTEXT)
		.map((context) => to_rest_context(context))

	return [...git_gh_pr_rollup.newest_check_runs(check_runs), ...statuses]
}

function to_required_contexts(base_reference: GraphqlPull['baseRef']): Array<string> {
	return (base_reference?.rules.nodes ?? [])
		.filter((rule) => rule.type === REQUIRED_STATUS_CHECKS)
		.flatMap((rule) => rule.parameters?.requiredStatusChecks ?? [])
		.map((check) => check.context)
}

// `REVIEW_REQUIRED` says no decision stands, which the REST fold answers as empty. **`null` is no
// answer**: GitHub leaves it unset where the base branch requires no review, even beside a standing
// change request, so the decision is handed to the REST review fold.
function to_review_decision(decision: string | null): string | undefined {
	if (decision === null) return undefined

	return DECISIONS.has(decision) ? decision : REVIEW_NONE
}

function to_checks_fields(
	pull: GraphqlPull,
	head_sha: string,
	contexts: ReadonlyArray<RollupContext>,
): Record<string, unknown> {
	return {
		statusCheckRollup: to_rest_rollup(contexts),
		mergeStateStatus: pull.mergeStateStatus,
		headRefOid: head_sha,
		requiredContexts: to_required_contexts(pull.baseRef),
		...(pull.merged && { merged: true }),
	}
}

async function query_pull(variables: Record<string, unknown>): Promise<AnsweredPull | undefined> {
	const data = await query_data(SNAPSHOT_QUERY, variables, snapshot_data_schema)
	if (data === undefined) return undefined

	const [pull] = data.repository.pullRequests.nodes
	if (pull === undefined || pull.isCrossRepository) return undefined

	return { pull, rate_limit: data.rateLimit }
}

async function read_pull(branch_name: string): Promise<AnsweredPull | undefined> {
	const repository = git_gh_issue_graphql.repository_variables_of()
	if (repository === undefined) return undefined

	return await query_pull({ ...repository, branch: branch_name })
}

async function read_head_snapshot(answered: AnsweredPull): Promise<GraphqlSnapshot | undefined> {
	const { pull, rate_limit } = answered
	const [node] = pull.commits.nodes
	if (node === undefined) return undefined

	const { id, oid, statusCheckRollup: rollup } = node.commit
	const read = await read_pages_from(id, { page: page_of(rollup), rate_limit })
	if (read === undefined) return undefined

	return {
		pr_number: pull.number,
		fields: to_checks_fields(pull, oid, read.contexts),
		review_decision: to_review_decision(pull.reviewDecision),
		rate_limit: read.rate_limit,
	}
}

async function read_snapshot(branch_name: string): Promise<GraphqlSnapshot | undefined> {
	const answered = await read_pull(branch_name)

	return answered && (await read_head_snapshot(answered))
}

async function read_review_decision(pr_number: number): Promise<string | undefined> {
	const repository = git_gh_issue_graphql.repository_variables_of()
	if (repository === undefined) return undefined

	const variables = { ...repository, number: pr_number }
	const data = await query_data(REVIEW_DECISION_QUERY, variables, decision_data_schema)

	return data && to_review_decision(data.repository.pullRequest.reviewDecision)
}

const git_gh_pr_graphql_snapshot = { read_snapshot, read_review_decision }

export type { GraphqlSnapshot }
export { git_gh_pr_graphql_snapshot, CONTEXTS_PAGE_QUERY, REVIEW_DECISION_QUERY, SNAPSHOT_QUERY }
