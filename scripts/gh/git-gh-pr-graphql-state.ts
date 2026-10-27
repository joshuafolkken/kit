import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { git_gh_exec } from './git-gh-exec'
import type { RestPull } from './git-gh-pr-rest'

// `mergeStateStatus` for a pull request whose single-pull REST read GitHub refuses as too many files
// changed (`git-gh-pr-too-large.ts`). The listing row that stands in for that read carries no
// `mergeable_state`, and the merge gate never reads an unknown state as clean — it would wait out its
// whole budget. GraphQL still answers for the same pull request, so the state is read there.
//
// **A failure is a stop with its reason, never a guess.** A cloud session is answered 403 for
// GraphQL; the merge gate then has no way to judge the pull request, and says so.

const GRAPHQL_PATH = 'graphql'

const MERGE_STATE_QUERY =
	'query($id: ID!) { node(id: $id) { ... on PullRequest { mergeStateStatus } } }'

const NO_MERGE_STATE_MESSAGE =
	'The merge state cannot be judged: GitHub refuses this pull request as too many files changed, and GraphQL did not answer its mergeStateStatus'

const merge_state_node_schema = z.looseObject({ mergeStateStatus: z.string() })
const merge_state_data_schema = z.looseObject({ node: merge_state_node_schema })
const merge_state_response_schema = z.looseObject({ data: merge_state_data_schema })

async function query_merge_state(node_id: string): Promise<string | undefined> {
	const json = await git_gh_exec.exec_gh_api({
		path: GRAPHQL_PATH,
		body: JSON.stringify({ query: MERGE_STATE_QUERY, variables: { id: node_id } }),
	})

	return parse_json_object_or_undefined(json, merge_state_response_schema)?.data.node
		.mergeStateStatus
}

async function try_query_merge_state(node_id: string | undefined): Promise<string | undefined> {
	if (node_id === undefined) return undefined

	try {
		return await query_merge_state(node_id)
	} catch {
		return undefined
	}
}

// `detail_error` is the 422 that sent the read here, kept as the cause so the stop names it.
async function read_merge_state_status(listed: RestPull, detail_error: unknown): Promise<string> {
	const state = await try_query_merge_state(listed.node_id)
	if (state === undefined) throw new Error(NO_MERGE_STATE_MESSAGE, { cause: detail_error })

	return state
}

const git_gh_pr_graphql_state = { read_merge_state_status }

export { git_gh_pr_graphql_state, GRAPHQL_PATH, MERGE_STATE_QUERY, NO_MERGE_STATE_MESSAGE }
