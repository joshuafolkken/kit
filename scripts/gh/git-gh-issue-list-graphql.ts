import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import {
	git_gh_issue_graphql,
	ISSUE_FIELDS,
	issue_fields_schema,
	PAGE,
} from './git-gh-issue-graphql'
import type { BlockedBy, RestIssue } from './git-gh-issue-rest'
import { git_gh_transport } from './git-gh-transport'

// The newest open issues under one label — rows, labels and blocker relations — in **one** GraphQL
// query (joshuafolkken/kit#6785). REST pages the listing and reads each declared blocker after it,
// every request against the 5,000-per-hour core budget; GraphQL is metered separately and answers a
// `backlog:next` cold scan in a few points.
//
// The rows are mapped by `git_gh_issue_graphql.to_rest_issue`, the single-issue read's mapping, so
// `git-gh-issue-rest.ts` stays the one translation to the `gh issue list --json` spelling.
//
// **`undefined` hands the listing back to REST**: a repository the checkout cannot name, a session on
// REST (`git-gh-transport.ts`), or an answer that fails the schema. Whether one page answers the
// caller is the listing's decision (`git-gh-issue-list.ts`), so `has_next_page` rides along.

const LISTING_QUERY = `query($owner: String!, $name: String!, $labels: [String!]) {
	rateLimit { cost remaining }
	repository(owner: $owner, name: $name) {
		issues(${PAGE}, labels: $labels, states: OPEN, orderBy: { field: CREATED_AT, direction: DESC }) {
			pageInfo { hasNextPage }
			nodes { ${ISSUE_FIELDS} }
		}
	}
}`

const rate_limit_schema = z.object({ cost: z.number(), remaining: z.number() })
const page_info_schema = z.object({ hasNextPage: z.boolean() })
const issues_schema = z.object({
	pageInfo: page_info_schema,
	nodes: z.array(issue_fields_schema),
})

const response_schema = z.looseObject({
	data: z.looseObject({
		rateLimit: rate_limit_schema,
		repository: z.looseObject({ issues: issues_schema }),
	}),
})

type ListingData = z.infer<typeof response_schema>['data']

interface ListedIssue {
	rest: RestIssue
	blocked_by: BlockedBy
}

// `cost` and `remaining` are the query's own `rateLimit`, returned as the batched reads return them.
interface OpenIssuePage {
	issues: Array<ListedIssue>
	has_next_page: boolean
	cost: number
	remaining: number
}

// An unlabelled listing leaves `$labels` out of the request, which GraphQL reads as no label filter.
function labels_of(label: string | undefined): Array<string> | undefined {
	return label === undefined ? undefined : [label]
}

function to_page(data: ListingData): OpenIssuePage {
	const { issues } = data.repository

	return {
		issues: issues.nodes.map((issue) => ({
			rest: git_gh_issue_graphql.to_rest_issue(issue),
			blocked_by: git_gh_issue_graphql.to_blocked_by(issue),
		})),
		has_next_page: issues.pageInfo.hasNextPage,
		cost: data.rateLimit.cost,
		remaining: data.rateLimit.remaining,
	}
}

async function read_open_page(
	label: string | undefined,
	repo?: string,
): Promise<OpenIssuePage | undefined> {
	const repository = git_gh_issue_graphql.repository_variables_of(repo)
	if (repository === undefined) return undefined

	const variables = { ...repository, labels: labels_of(label) }
	const json = await git_gh_transport.query({ query: LISTING_QUERY, variables })
	if (json === undefined) return undefined

	const data = json_value.parse_with(json, response_schema)?.data

	return data === undefined ? undefined : to_page(data)
}

const git_gh_issue_list_graphql = {
	read_open_page,
}

export type { ListedIssue, OpenIssuePage }
export { git_gh_issue_list_graphql }
