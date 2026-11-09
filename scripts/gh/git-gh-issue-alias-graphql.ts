import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { git_gh_blocked_by_graphql } from './git-gh-blocked-by-graphql'
import { git_gh_issue_graphql, type RepositoryVariables } from './git-gh-issue-graphql'
import { git_gh_transport } from './git-gh-transport'

// Any fields of many issues in one GraphQL query per hundred (joshuafolkken/kit#6791), each issue an
// aliased `issue(number:)` field of its repository, since a caller holds numbers rather than the
// `node_id`s `nodes(ids:)` needs. The caller names the fields and the schema one issue answers in.
//
// **A number missing from the answer is the caller's to read through REST**: a session on REST
// (`git-gh-transport.ts`), a failed query — one number that is a pull request or nothing fails the
// whole document — or a repository the checkout cannot name.

const ALIAS_PREFIX = 'issue'

const rate_limit_schema = z.object({ cost: z.number(), remaining: z.number() })

// What GraphQL answered, keyed by number, and what the queries cost: `cost` sums the points every
// answered query spent, `remaining` is the GraphQL budget the last one left.
interface AliasRead<T> {
	answers: Map<number, T>
	cost: number
	remaining: number | undefined
}

interface ChunkData<T> {
	rateLimit: z.infer<typeof rate_limit_schema>
	repository: Record<string, T | null>
}

function alias_of(issue_number: number): string {
	return `${ALIAS_PREFIX}${String(issue_number)}`
}

function query_of(issue_numbers: ReadonlyArray<number>, fields: string): string {
	const aliases = issue_numbers.map(
		(issue_number) =>
			`${alias_of(issue_number)}: issue(number: ${String(issue_number)}) { ${fields} }`,
	)

	return `query($owner: String!, $name: String!) {
	rateLimit { cost remaining }
	repository(owner: $owner, name: $name) { ${aliases.join('\n')} }
}`
}

function response_schema_of<T>(issue_schema: z.ZodType<T>): z.ZodType<{ data: ChunkData<T> }> {
	const repository_schema = z.record(z.string(), issue_schema.nullable())
	const data_schema = z.looseObject({ rateLimit: rate_limit_schema, repository: repository_schema })

	return z.looseObject({ data: data_schema })
}

async function query_chunk<T>(
	issue_numbers: ReadonlyArray<number>,
	fields: string,
	issue_schema: z.ZodType<T>,
	variables: RepositoryVariables,
): Promise<ChunkData<T> | undefined> {
	const json = await git_gh_transport.query({ query: query_of(issue_numbers, fields), variables })
	if (json === undefined) return undefined

	return json_value.parse_with(json, response_schema_of(issue_schema))?.data
}

function with_chunk<T>(
	read: AliasRead<T>,
	issue_numbers: ReadonlyArray<number>,
	data: ChunkData<T> | undefined,
): AliasRead<T> {
	if (data === undefined) return read

	const answered = issue_numbers.flatMap((issue_number): Array<[number, T]> => {
		const issue = data.repository[alias_of(issue_number)]

		return issue === undefined || issue === null ? [] : [[issue_number, issue]]
	})

	return {
		answers: new Map([...read.answers, ...answered]),
		cost: read.cost + data.rateLimit.cost,
		remaining: data.rateLimit.remaining,
	}
}

// The issues of one repository (`repo` as `--repo` names it; the checkout's own when absent), each
// answering `fields` in `issue_schema`.
async function read_aliased<T>(
	issue_numbers: ReadonlyArray<number>,
	fields: string,
	issue_schema: z.ZodType<T>,
	repo?: string,
): Promise<AliasRead<T>> {
	const variables =
		issue_numbers.length === 0 ? undefined : git_gh_issue_graphql.repository_variables_of(repo)
	let read: AliasRead<T> = { answers: new Map(), cost: 0, remaining: undefined }
	if (variables === undefined) return read

	const chunks = git_gh_blocked_by_graphql.chunks_of([...new Set(issue_numbers)])

	for (const chunk of chunks) {
		// eslint-disable-next-line no-await-in-loop -- one query at a time keeps the burst to one request
		read = with_chunk(read, chunk, await query_chunk(chunk, fields, issue_schema, variables))
	}

	return read
}

const git_gh_issue_alias_graphql = { read_aliased }

export type { AliasRead }
export { git_gh_issue_alias_graphql }
