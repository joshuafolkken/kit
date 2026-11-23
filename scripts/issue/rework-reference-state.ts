import { git_gh_blocked_by_graphql } from '#scripts/gh/git-gh-blocked-by-graphql'
import { git_gh_issue_graphql } from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// Which `#<N>` a body cites are delivered work — a merged pull request or a closed Issue — read in one
// GraphQL query per hundred numbers, for the rework check of `issue:file` and
// `issue:rework-candidates` (joshuafolkken/kit#8799). `undefined` when any chunk goes unanswered, so
// the caller decides whether an unreadable state blocks or passes.

const ALIAS_PREFIX = 'n'
const DELIVERED = new Set(['Issue CLOSED', 'PullRequest MERGED'])

const node_schema = z.object({ kind: z.string(), state: z.string() })

const repository_schema = z.record(z.string(), z.unknown())
const data_schema = z.looseObject({ repository: repository_schema })
const response_schema = z.looseObject({ data: data_schema })

function query_of(numbers: ReadonlyArray<number>): string {
	const aliases = numbers.map(
		(number) =>
			`${ALIAS_PREFIX}${String(number)}: issueOrPullRequest(number: ${String(number)}) { kind: __typename ... on Issue { state } ... on PullRequest { state } }`,
	)

	return `query($owner: String!, $name: String!) {
	repository(owner: $owner, name: $name) { ${aliases.join('\n')} }
}`
}

function is_delivered(node: unknown): boolean {
	const parsed = node_schema.safeParse(node)

	return parsed.success && DELIVERED.has(`${parsed.data.kind} ${parsed.data.state}`)
}

async function delivered_in_chunk(
	numbers: ReadonlyArray<number>,
	variables: object,
): Promise<ReadonlyArray<number> | undefined> {
	const json = await git_gh_transport.query_partial({ query: query_of(numbers), variables })
	const data = json === undefined ? undefined : json_value.parse_with(json, response_schema)?.data
	if (data === undefined) return undefined

	return numbers.filter((number) =>
		is_delivered(data.repository[`${ALIAS_PREFIX}${String(number)}`]),
	)
}

// The delivered numbers among `numbers` in `repo` (`owner/repo`; the checkout's own when absent).
async function delivered(
	numbers: ReadonlyArray<number>,
	repo?: string,
): Promise<ReadonlySet<number> | undefined> {
	if (numbers.length === 0) return new Set()
	const variables = git_gh_issue_graphql.repository_variables_of(repo)
	if (variables === undefined) return undefined
	const chunks = git_gh_blocked_by_graphql.chunks_of([...new Set(numbers)])
	const answers = await Promise.all(
		chunks.map(async (chunk) => await delivered_in_chunk(chunk, variables)),
	)

	if (answers.includes(undefined)) return undefined

	return new Set(answers.flatMap((answer) => answer ?? []))
}

const rework_reference_state = { delivered }

export { rework_reference_state }
