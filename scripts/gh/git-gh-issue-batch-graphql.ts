import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { git_gh_blocked_by_graphql } from './git-gh-blocked-by-graphql'
import {
	git_gh_issue_graphql,
	ISSUE_FIELDS,
	issue_fields_schema,
	type GraphqlIssueFields,
	type RepositoryVariables,
} from './git-gh-issue-graphql'
import { STATE_AND_RELATIONS_FIELDS, type IssueRead } from './git-gh-issue-read'
import { git_gh_issue_rest } from './git-gh-issue-rest'
import { git_gh_transport } from './git-gh-transport'

// An epic's children — state, labels, blocker relations, body and author — in one GraphQL query per
// hundred (joshuafolkken/kit#6792). REST reads them one issue at a time, one or two core requests
// each, so a 200-child epic spent hundreds of the 5,000-per-hour core budget on every `epic:next`.
// The children are addressed as aliased `issue(number:)` fields of their repository, since a task
// list carries numbers rather than the `node_id`s `nodes(ids:)` needs.
//
// Each answer is mapped into the read `issue_get_state_and_relations_classified` produces, through
// the same REST mapping (`git-gh-issue-graphql.ts`), so nothing downstream changes.
//
// **A number missing from the answer is the caller's to read through REST**: a session on REST
// (`git-gh-transport.ts`), a failed query, a repository the checkout cannot name, a pull request
// (below), or a number that resolves to nothing — its alias answers `null` beside an `errors` entry,
// and `gh` exits non-zero while the other aliases still answer (`query_partial`,
// joshuafolkken/kit#6964).
// REST keeps telling a missing number from a failed read, which a GraphQL error document does not.
//
// Each alias asks `issueOrPullRequest` for the issue fields only, so a pull request answers an empty
// object that leaves its own number to REST — REST tells it apart by its URL — instead of failing
// the chunk it shares with up to ninety-nine issues (joshuafolkken/kit#6869).

const ALIAS_PREFIX = 'issue'

const rate_limit_schema = z.object({ cost: z.number(), remaining: z.number() })

// Each alias is checked on its own: `null` for nothing at that number, `{}` for a pull request.
const repository_schema = z.record(z.string(), z.unknown())

const data_schema = z.looseObject({ rateLimit: rate_limit_schema, repository: repository_schema })

const response_schema = z.looseObject({ data: data_schema })

type ChunkData = z.infer<typeof data_schema>

// The reads GraphQL answered, keyed by number, and what the queries cost: `cost` sums the points
// every answered query spent, `remaining` is the GraphQL budget the last one left.
interface BatchRead {
	reads: Map<number, IssueRead>
	cost: number
	remaining: number | undefined
}

function alias_of(issue_number: number): string {
	return `${ALIAS_PREFIX}${String(issue_number)}`
}

function query_of(issue_numbers: ReadonlyArray<number>): string {
	const aliases = issue_numbers.map(
		(issue_number) =>
			`${alias_of(issue_number)}: issueOrPullRequest(number: ${String(issue_number)}) { ... on Issue { ${ISSUE_FIELDS} } }`,
	)

	return `query($owner: String!, $name: String!) {
	rateLimit { cost remaining }
	repository(owner: $owner, name: $name) { ${aliases.join('\n')} }
}`
}

function answered(json: string): IssueRead {
	return { kind: 'read', json }
}

// `fields` is the `--json` list of the REST read the answer stands in for.
function to_read(issue: GraphqlIssueFields, fields: string): IssueRead {
	const issue_json = git_gh_issue_rest.to_gh_issue(
		git_gh_issue_graphql.to_rest_issue(issue),
		git_gh_issue_rest.split_fields(fields),
		git_gh_issue_graphql.to_blocked_by(issue),
	)

	return answered(JSON.stringify(issue_json))
}

async function query_chunk(
	issue_numbers: ReadonlyArray<number>,
	variables: RepositoryVariables,
): Promise<ChunkData | undefined> {
	const json = await git_gh_transport.query_partial({ query: query_of(issue_numbers), variables })
	if (json === undefined) return undefined

	return json_value.parse_with(json, response_schema)?.data
}

// One chunk's numbers and the fields their reads carry.
interface ChunkRequest {
	issue_numbers: ReadonlyArray<number>
	fields: string
}

function answered_reads(request: ChunkRequest, data: ChunkData): Array<[number, IssueRead]> {
	return request.issue_numbers.flatMap((issue_number): Array<[number, IssueRead]> => {
		const issue = issue_fields_schema.safeParse(data.repository[alias_of(issue_number)])

		return issue.success ? [[issue_number, to_read(issue.data, request.fields)]] : []
	})
}

function with_chunk(
	batch: BatchRead,
	request: ChunkRequest,
	data: ChunkData | undefined,
): BatchRead {
	if (data === undefined) return batch

	return {
		reads: new Map([...batch.reads, ...answered_reads(request, data)]),
		cost: batch.cost + data.rateLimit.cost,
		remaining: data.rateLimit.remaining,
	}
}

function empty_batch(): BatchRead {
	return { reads: new Map(), cost: 0, remaining: undefined }
}

// The children of one repository (`repo` as `--repo` names it; the checkout's own when absent).
async function read_many(
	issue_numbers: ReadonlyArray<number>,
	repo?: string,
	fields: string = STATE_AND_RELATIONS_FIELDS,
): Promise<BatchRead> {
	const variables =
		issue_numbers.length === 0 ? undefined : git_gh_issue_graphql.repository_variables_of(repo)
	let batch = empty_batch()
	if (variables === undefined) return batch

	const chunks = git_gh_blocked_by_graphql.chunks_of([...new Set(issue_numbers)])

	for (const chunk of chunks) {
		const request = { issue_numbers: chunk, fields }

		// eslint-disable-next-line no-await-in-loop -- one query at a time keeps the burst to one request
		batch = with_chunk(batch, request, await query_chunk(chunk, variables))
	}

	return batch
}

const git_gh_issue_batch_graphql = { answered, empty_batch, read_many }

export type { BatchRead }
export { git_gh_issue_batch_graphql }
