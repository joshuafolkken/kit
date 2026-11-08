import { repo_party } from '#scripts/discovery/repo-party'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import type { BlockedBy, RestIssue } from './git-gh-issue-rest'
import { GRAPHQL_PATH } from './git-gh-pr-graphql-state'

// One issue's body, labels, blocker relations and comments in **one** GraphQL query
// (joshuafolkken/kit#6722). REST serves them from three endpoints, each a request against the
// 5,000-per-hour core budget every lane, the run board and the offer share; GraphQL is metered
// separately and answers all four at once.
//
// The answer is mapped into the shapes the REST reads already produce — `RestIssue`, `BlockedBy` and
// the comment listing as served — so `git-gh-issue-rest.ts` stays the one translation to the
// `gh issue view --json` spelling and no caller downstream changes.
//
// **`undefined` hands the read back to REST**, never a partial answer: a repository the checkout
// cannot name, a cloud session's 403, a number that is a pull request or nothing (GraphQL answers
// `null` with an `errors` document, which fails the schema), or more comments than one page. REST
// keeps telling a missing number from a failed read, which a GraphQL error document does not.

// The page REST's listings ask for, so a GraphQL answer holds as many rows as the read it replaces.
const PAGE = `first: ${String(git_gh_api_path.FULL_PAGE_SIZE)}`
// REST spells a bot's login with this suffix; GraphQL names the bot alone.
const BOT_TYPE = 'Bot'
const BOT_SUFFIX = '[bot]'
// REST's blocker rows carry the repository as an API URL; `git_gh_issue_rest.repo_of_url` reads its
// tail.
const REPOSITORY_API_URL = 'https://api.github.com/repos/'

const AUTHOR = 'author { login type: __typename }'
const BLOCKER = 'number state repository { nameWithOwner }'
const COMMENT = `url body createdAt authorAssociation ${AUTHOR}`

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		issue(number: $number) {
			number title state body url createdAt authorAssociation ${AUTHOR}
			labels(${PAGE}) { nodes { name } }
			blockedBy(${PAGE}) { totalCount nodes { ${BLOCKER} } }
			comments(${PAGE}) { pageInfo { hasNextPage } nodes { ${COMMENT} } }
		}
	}
}`

const author_schema = z.object({ login: z.string(), type: z.string() }).nullable()
const label_schema = z.object({ name: z.string() })
const page_info_schema = z.object({ hasNextPage: z.boolean() })

const comment_node_schema = z.object({
	url: z.string(),
	body: z.string(),
	createdAt: z.string(),
	authorAssociation: z.string(),
	author: author_schema,
})

const blocker_node_schema = z.object({
	number: z.number(),
	state: z.string(),
	repository: z.object({ nameWithOwner: z.string() }),
})

const issue_schema = z.object({
	number: z.number(),
	title: z.string(),
	state: z.string(),
	body: z.string(),
	url: z.string(),
	createdAt: z.string(),
	authorAssociation: z.string(),
	author: author_schema,
	labels: z.object({ nodes: z.array(label_schema) }),
	blockedBy: z.object({ totalCount: z.number(), nodes: z.array(blocker_node_schema) }),
	comments: z.object({ pageInfo: page_info_schema, nodes: z.array(comment_node_schema) }),
})

const response_schema = z.looseObject({
	data: z.looseObject({ repository: z.looseObject({ issue: issue_schema }) }),
})

type GraphqlIssue = z.infer<typeof issue_schema>
type GraphqlAuthor = z.infer<typeof author_schema>
type BlockerNode = z.infer<typeof blocker_node_schema>
type BlockingIssue = BlockedBy['nodes'][number]

interface IssueWithComments {
	rest: RestIssue
	blocked_by: BlockedBy
	comments_json: string
}

interface IssueVariables {
	owner: string
	name: string
	number: number
}

// The repository a REST path would leave to `gh`'s `{owner}/{repo}` expansion has to be spelled out
// here, and it is read from the checkout's remotes rather than asked of the REST API.
function variables_of(issue_number: string, repo?: string): IssueVariables | undefined {
	const identity =
		repo === undefined ? repo_party.current_repository() : repo_party.parse_owner_repo(repo)

	if (identity === undefined) return undefined

	return { owner: identity.owner, name: identity.repo, number: Number(issue_number) }
}

// A deleted account answers `null`, which REST's own schema reads as no author.
function user_of(author: GraphqlAuthor): { user?: { login: string } } {
	if (author === null) return {}

	const suffix = author.type === BOT_TYPE ? BOT_SUFFIX : ''

	return { user: { login: `${author.login}${suffix}` } }
}

function to_rest_comments(issue: GraphqlIssue): string {
	const rows = issue.comments.nodes.map((comment) => ({
		html_url: comment.url,
		body: comment.body,
		created_at: comment.createdAt,
		author_association: comment.authorAssociation,
		...user_of(comment.author),
	}))

	return JSON.stringify(rows)
}

// One blocker node in the shape REST's blocker rows map to — shared with the listing's batched read
// (`git-gh-blocked-by-graphql.ts`), so both GraphQL reads answer what `to_blocked_by` in REST does.
function to_blocking_issue(blocker: BlockerNode): BlockingIssue {
	return {
		number: blocker.number,
		state: blocker.state,
		repository_url: `${REPOSITORY_API_URL}${blocker.repository.nameWithOwner}`,
	}
}

function to_blocked_by(issue: GraphqlIssue): BlockedBy {
	return {
		nodes: issue.blockedBy.nodes.map((blocker) => to_blocking_issue(blocker)),
		totalCount: issue.blockedBy.totalCount,
	}
}

function to_rest_issue(issue: GraphqlIssue): RestIssue {
	return {
		number: issue.number,
		title: issue.title,
		state: issue.state,
		body: issue.body,
		html_url: issue.url,
		created_at: issue.createdAt,
		author_association: issue.authorAssociation,
		...user_of(issue.author),
		labels: issue.labels.nodes,
		issue_dependencies_summary: { total_blocked_by: issue.blockedBy.totalCount },
	}
}

function to_issue_with_comments(issue: GraphqlIssue | undefined): IssueWithComments | undefined {
	if (issue === undefined || issue.comments.pageInfo.hasNextPage) return undefined

	return {
		rest: to_rest_issue(issue),
		blocked_by: to_blocked_by(issue),
		comments_json: to_rest_comments(issue),
	}
}

async function read_issue(
	issue_number: string,
	repo?: string,
): Promise<IssueWithComments | undefined> {
	const variables = variables_of(issue_number, repo)
	if (variables === undefined) return undefined

	try {
		const json = await git_gh_exec.exec_gh_api({
			path: GRAPHQL_PATH,
			body: JSON.stringify({ query: ISSUE_QUERY, variables }),
		})

		return to_issue_with_comments(
			parse_json_object_or_undefined(json, response_schema)?.data.repository.issue,
		)
	} catch {
		return undefined
	}
}

const git_gh_issue_graphql = { read_issue, to_blocking_issue }

export type { IssueWithComments }
export { git_gh_issue_graphql, BLOCKER, PAGE, blocker_node_schema }
