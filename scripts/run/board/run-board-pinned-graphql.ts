import { git_gh_issue_graphql } from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The repository's pinned issues — at most three, in GitHub's order — for the board's watch panel
// (joshuafolkken/kit#8606): which issues to watch is chosen by pinning them on GitHub. One GraphQL
// query on the board's GitHub reads (`run-board-github.ts`); a failed read, or a REST session,
// answers `undefined` so the board keeps the pins it last read.

const PIN_LIMIT = 3
const CLOSED_STATE = 'CLOSED'

interface PinnedIssue {
	number: number
	is_closed: boolean
	closed_ms: number | undefined
}

const PINNED_QUERY = `query($owner: String!, $name: String!) {
	repository(owner: $owner, name: $name) {
		pinnedIssues(first: ${String(PIN_LIMIT)}) { nodes { issue { number state closedAt } } }
	}
}`

const issue_schema = z.object({
	number: z.number(),
	state: z.string(),
	closedAt: z.string().nullish(),
})

const pins_schema = z.object({ nodes: z.array(z.object({ issue: issue_schema })) })

const answer_schema = z.object({
	data: z.object({ repository: z.object({ pinnedIssues: pins_schema }) }),
})

type IssueNode = z.infer<typeof issue_schema>

function closed_ms_of(closed_at: string | null | undefined): number | undefined {
	return closed_at === null || closed_at === undefined ? undefined : Date.parse(closed_at)
}

function to_pinned(issue: IssueNode): PinnedIssue {
	return {
		number: issue.number,
		is_closed: issue.state === CLOSED_STATE,
		closed_ms: closed_ms_of(issue.closedAt),
	}
}

function pinned_of(text: string | undefined): ReadonlyArray<PinnedIssue> | undefined {
	if (text === undefined) return undefined

	const answer = json_value.parse_with(text, answer_schema)

	return answer?.data.repository.pinnedIssues.nodes.map((node) => to_pinned(node.issue))
}

// `repo` as `owner/repo`; a repository that cannot be spelled, or GitHub not answering, is no read.
async function read_pinned(repo: string): Promise<ReadonlyArray<PinnedIssue> | undefined> {
	const variables = git_gh_issue_graphql.repository_variables_of(repo)

	if (variables === undefined) return undefined

	return pinned_of(await git_gh_transport.query({ query: PINNED_QUERY, variables }))
}

const run_board_pinned_graphql = { pinned_of, read_pinned }

export { run_board_pinned_graphql }
export type { PinnedIssue }
