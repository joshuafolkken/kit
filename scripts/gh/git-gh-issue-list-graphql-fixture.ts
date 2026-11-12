import {
	ISSUE_BODY,
	ISSUE_CREATED_AT,
	ISSUE_HTML_URL,
	ISSUE_LABEL,
	ISSUE_NUMBER,
	ISSUE_TITLE,
} from './git-gh-issue-rest-fixture'

// The open-issue listing as the GraphQL query of `git-gh-issue-list-graphql.ts` answers it. The
// listing's own tests and the `backlog:next` budget test both serve the pool this way, so the
// builder lives here rather than once per test file.

const OWNER_ASSOCIATION = 'OWNER'
const OWNER_LOGIN = 'joshuafolkken'
// What tells the listing query apart from the scan's other GraphQL queries in a routed fake.
const LISTING_CONNECTION = 'issues('

function graphql_labels(names: ReadonlyArray<string>): Record<string, unknown> {
	return { nodes: names.map((name) => ({ name })) }
}

// One issue node; `blockedBy` is empty unless the override names a blocker.
function graphql_issue_node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		number: ISSUE_NUMBER,
		title: ISSUE_TITLE,
		state: 'OPEN',
		body: ISSUE_BODY,
		url: ISSUE_HTML_URL,
		createdAt: ISSUE_CREATED_AT,
		authorAssociation: OWNER_ASSOCIATION,
		author: { login: OWNER_LOGIN, type: 'User' },
		labels: graphql_labels([ISSUE_LABEL]),
		blockedBy: { totalCount: 0, nodes: [] },
		...overrides,
	}
}

function graphql_listing(
	nodes: ReadonlyArray<Record<string, unknown>>,
	has_next_page = false,
): string {
	const issues = { pageInfo: { hasNextPage: has_next_page }, nodes }

	return JSON.stringify({
		data: { rateLimit: { cost: 1, remaining: 4999 }, repository: { issues } },
	})
}

function is_listing_query(body = ''): boolean {
	return body.includes(LISTING_CONNECTION)
}

export {
	graphql_issue_node,
	graphql_labels,
	graphql_listing,
	is_listing_query,
	OWNER_ASSOCIATION,
	OWNER_LOGIN,
}
