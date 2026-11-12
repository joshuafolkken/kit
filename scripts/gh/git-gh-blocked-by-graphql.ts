import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { BLOCKER, blocker_node_schema, git_gh_issue_graphql, PAGE } from './git-gh-issue-graphql'
import { git_gh_issue_rest, type BlockedBy, type RestIssue } from './git-gh-issue-rest'
import { git_gh_transport } from './git-gh-transport'

// A listing's blocker relations in one GraphQL query per hundred rows (joshuafolkken/kit#6634).
// REST serves them from each issue's own dependencies endpoint, so a `backlog:next` scan cost one
// request per row declaring a blocker; `nodes(ids:)` addresses the rows by the `node_id` the listing
// already carries, with no repository to resolve.
//
// **A row missing from the answer is read through REST**, never as "no blockers": a failed query
// (one unresolvable id fails the whole document, and `gh` exits non-zero), a session on REST
// (`git-gh-transport.ts`), an unresolved node, or a row without a `node_id`. An empty `nodes` would let `backlog:next` start a dependent before its
// prerequisite.

// `nodes(ids:)` accepts at most a hundred ids; the epic children's aliased read keeps to the same
// hundred per query (`git-gh-issue-batch-graphql.ts`).
const IDS_PER_QUERY = 100

const BLOCKED_BY_QUERY = `query($ids: [ID!]!) {
	nodes(ids: $ids) { ... on Issue { id blockedBy(${PAGE}) { nodes { ${BLOCKER} } } } }
}`

const issue_node_schema = z.object({
	id: z.string(),
	blockedBy: z.object({ nodes: z.array(blocker_node_schema) }),
})

const nodes_schema = z.array(issue_node_schema.nullable())

const response_schema = z.looseObject({ data: z.looseObject({ nodes: nodes_schema }) })

type IssueNode = z.infer<typeof issue_node_schema>

// The rows `read_blocked_by` would send a request for: GitHub's own summary does not already say
// "none". A row with a zero summary is answered there without a request, so it is left to it.
function needs_read(row: RestIssue): row is RestIssue & { node_id: string } {
	if (row.node_id === undefined || git_gh_issue_rest.is_pull_request(row)) return false

	return git_gh_issue_rest.total_blocked_by(row) !== 0
}

function chunks_of<T>(items: ReadonlyArray<T>): Array<Array<T>> {
	const chunks: Array<Array<T>> = []

	for (let start = 0; start < items.length; start += IDS_PER_QUERY) {
		chunks.push(items.slice(start, start + IDS_PER_QUERY))
	}

	return chunks
}

// `totalCount` is the row's own summary, as the REST read reports it; the page length only where the
// summary is absent.
function to_blocked_by(row: RestIssue, node: IssueNode): BlockedBy {
	const nodes = node.blockedBy.nodes.map((blocker) =>
		git_gh_issue_graphql.to_blocking_issue(blocker),
	)

	return { nodes, totalCount: git_gh_issue_rest.total_blocked_by(row) ?? nodes.length }
}

async function query_nodes(ids: ReadonlyArray<string>): Promise<Array<IssueNode | null>> {
	const json = await git_gh_transport.query({ query: BLOCKED_BY_QUERY, variables: { ids } })
	if (json === undefined) return []

	return json_value.parse_with(json, response_schema)?.data.nodes ?? []
}

// An unresolved id answers `null` in its slot; it is left out, so its row falls to REST.
function index_by_id(nodes: ReadonlyArray<IssueNode | null>): Map<string, IssueNode> {
	const resolved = nodes.filter((node) => node !== null)

	return new Map(resolved.map((node) => [node.id, node]))
}

async function read_chunk(
	rows: ReadonlyArray<RestIssue & { node_id: string }>,
	answered: Map<RestIssue, BlockedBy>,
): Promise<void> {
	const by_id = index_by_id(await query_nodes(rows.map((row) => row.node_id)))

	for (const row of rows) {
		const node = by_id.get(row.node_id)

		if (node !== undefined) answered.set(row, to_blocked_by(row, node))
	}
}

// The relations GraphQL answered, keyed by the row they belong to. A row absent from the map is the
// caller's to read through REST.
async function read_answered(rows: ReadonlyArray<RestIssue>): Promise<Map<RestIssue, BlockedBy>> {
	const answered = new Map<RestIssue, BlockedBy>()
	const chunks = chunks_of(rows.filter((row) => needs_read(row)))

	for (const chunk of chunks) {
		// eslint-disable-next-line no-await-in-loop -- one query at a time keeps the burst to one request
		await read_chunk(chunk, answered)
	}

	return answered
}

const git_gh_blocked_by_graphql = { chunks_of, read_answered }

export { git_gh_blocked_by_graphql, IDS_PER_QUERY }
