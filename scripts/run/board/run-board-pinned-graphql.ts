import {
	git_gh_issue_graphql,
	ISSUE_FIELDS,
	issue_fields_schema,
	PAGE,
} from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { run_board_watch_rank } from './run-board-watch-rank'

// The board's watch panel (joshuafolkken/kit#8606, joshuafolkken/kit#8631): the repository's pinned
// issues — at most three, in GitHub's order — then its open `priority:critical` and `priority:high`
// ones, composed by `run-board-watch-rank.ts`. One GraphQL query on the board's GitHub reads
// (`run-board-github.ts`); a failed read, or a REST session, answers `undefined` so the board keeps
// the rows it last read.

const CLOSED_STATE = 'CLOSED'

// A row of the panel — a pinned issue as read, or a priority issue (always open). The name stays from
// when the panel held pins alone.
interface PinnedIssue {
	number: number
	is_closed: boolean
	closed_ms: number | undefined
}

// `labels` is not an OR, so each priority is its own aliased listing.
function priority_listing(alias: string, label: string): string {
	return `${alias}: issues(${PAGE}, labels: ["${label}"], states: OPEN) { nodes { ${ISSUE_FIELDS} } }`
}

const PINNED_QUERY = `query($owner: String!, $name: String!) {
	repository(owner: $owner, name: $name) {
		pinnedIssues(first: ${String(run_board_watch_rank.WATCH_LIMIT)}) { nodes { issue { number state closedAt } } }
		${priority_listing('critical', PRIORITY_CRITICAL_LABEL)}
		${priority_listing('high', PRIORITY_HIGH_LABEL)}
	}
}`

const issue_schema = z.object({
	number: z.number(),
	state: z.string(),
	closedAt: z.string().nullish(),
})

const pins_schema = z.object({ nodes: z.array(z.object({ issue: issue_schema })) })
const listing_schema = z.object({ nodes: z.array(issue_fields_schema) })

const answer_schema = z.object({
	data: z.object({
		repository: z.object({
			pinnedIssues: pins_schema,
			critical: listing_schema,
			high: listing_schema,
		}),
	}),
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

// `repo` as `owner/repo`, the repository the priority rows belong to.
function pinned_of(text: string | undefined, repo: string): ReadonlyArray<PinnedIssue> | undefined {
	if (text === undefined) return undefined

	const repository = json_value.parse_with(text, answer_schema)?.data.repository

	if (repository === undefined) return undefined

	const pins = repository.pinnedIssues.nodes.map((node) => to_pinned(node.issue))
	const tiers = [repository.critical.nodes, repository.high.nodes]

	return run_board_watch_rank.watch_rows(pins, tiers, repo)
}

// A repository that cannot be spelled, or GitHub not answering, is no read.
async function read_pinned(repo: string): Promise<ReadonlyArray<PinnedIssue> | undefined> {
	const variables = git_gh_issue_graphql.repository_variables_of(repo)

	if (variables === undefined) return undefined

	return pinned_of(await git_gh_transport.query({ query: PINNED_QUERY, variables }), repo)
}

const run_board_pinned_graphql = { PINNED_QUERY, pinned_of, read_pinned }

export { run_board_pinned_graphql }
export type { PinnedIssue }
