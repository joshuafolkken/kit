import { repo_party } from '#scripts/discovery/repo-party'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { git_gh_api_path } from './git-gh-api-path'
import type { BlockedBy, RestIssue } from './git-gh-issue-rest'
import { git_gh_transport } from './git-gh-transport'

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
// cannot name, a session on REST (`git-gh-transport.ts`), a number that is a pull request or nothing (GraphQL answers
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
// An issue's comments with the page flag that tells a full listing from a cut one — shared with
// `run:board`'s batched decision read (`run-board-decision-graphql.ts`).
const COMMENTS = `comments(${PAGE}) { pageInfo { hasNextPage } nodes { ${COMMENT} } }`

// The fields `to_rest_issue` maps — shared with the epic children's batched read
// (`git-gh-issue-batch-graphql.ts`), so both answer the same REST shape.
const ISSUE_FIELDS = `number title state body url createdAt authorAssociation ${AUTHOR}
	labels(${PAGE}) { nodes { name } }
	blockedBy(${PAGE}) { totalCount nodes { ${BLOCKER} } }`

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		issue(number: $number) {
			${ISSUE_FIELDS}
			${COMMENTS}
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

const issue_fields_schema = z.object({
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
})

const comments_schema = z.object({
	comments: z.object({ pageInfo: page_info_schema, nodes: z.array(comment_node_schema) }),
})

const issue_schema = issue_fields_schema.extend(comments_schema.shape)

const response_schema = z.looseObject({
	data: z.looseObject({ repository: z.looseObject({ issue: issue_schema }) }),
})

type GraphqlIssue = z.infer<typeof issue_schema>
type GraphqlIssueFields = z.infer<typeof issue_fields_schema>
type GraphqlComments = z.infer<typeof comments_schema>['comments']
type GraphqlAuthor = z.infer<typeof author_schema>
type BlockerNode = z.infer<typeof blocker_node_schema>
type BlockingIssue = BlockedBy['nodes'][number]

interface IssueWithComments {
	rest: RestIssue
	blocked_by: BlockedBy
	comments_json: string
}

interface RepositoryVariables {
	owner: string
	name: string
}

interface IssueVariables extends RepositoryVariables {
	number: number
}

// The repository a REST path would leave to `gh`'s `{owner}/{repo}` expansion has to be spelled out
// here, and it is read from the checkout's remotes rather than asked of the REST API.
function repository_variables_of(repo?: string): RepositoryVariables | undefined {
	const identity =
		repo === undefined ? repo_party.current_repository() : repo_party.parse_owner_repo(repo)

	if (identity === undefined) return undefined

	return { owner: identity.owner, name: identity.repo }
}

function variables_of(issue_number: string, repo?: string): IssueVariables | undefined {
	const repository = repository_variables_of(repo)
	if (repository === undefined) return undefined

	return { ...repository, number: Number(issue_number) }
}

// A deleted account answers `null`, which REST's own schema reads as no author.
function user_of(author: GraphqlAuthor): { user?: { login: string } } {
	if (author === null) return {}

	const suffix = author.type === BOT_TYPE ? BOT_SUFFIX : ''

	return { user: { login: `${author.login}${suffix}` } }
}

function to_rest_comments(comments: GraphqlComments['nodes']): string {
	const rows = comments.map((comment) => ({
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

function to_blocked_by(issue: GraphqlIssueFields): BlockedBy {
	return {
		nodes: issue.blockedBy.nodes.map((blocker) => to_blocking_issue(blocker)),
		totalCount: issue.blockedBy.totalCount,
	}
}

function to_rest_issue(issue: GraphqlIssueFields): RestIssue {
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
		comments_json: to_rest_comments(issue.comments.nodes),
	}
}

async function read_issue(
	issue_number: string,
	repo?: string,
): Promise<IssueWithComments | undefined> {
	const variables = variables_of(issue_number, repo)
	if (variables === undefined) return undefined

	const json = await git_gh_transport.query({ query: ISSUE_QUERY, variables })
	if (json === undefined) return undefined

	return to_issue_with_comments(json_value.parse_with(json, response_schema)?.data.repository.issue)
}

const git_gh_issue_graphql = {
	read_issue,
	repository_variables_of,
	to_blocked_by,
	to_blocking_issue,
	to_rest_comments,
	to_rest_issue,
}

export type { GraphqlComments, GraphqlIssueFields, IssueWithComments, RepositoryVariables }
export {
	git_gh_issue_graphql,
	BLOCKER,
	COMMENTS,
	ISSUE_FIELDS,
	PAGE,
	blocker_node_schema,
	comments_schema,
	issue_fields_schema,
}
