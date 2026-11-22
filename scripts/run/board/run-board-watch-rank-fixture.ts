import type { GraphqlIssueFields } from '#scripts/gh/git-gh-issue-graphql'

// A priority listing's GraphQL node for the watch panel's tests (joshuafolkken/kit#8631): an open issue
// with no blockers, `body` carrying whatever the ranking reads.

const CREATED_AT = '2026-11-01T00:00:00Z'

function issue_node(number: number, body = ''): GraphqlIssueFields {
	return {
		number,
		title: `issue ${String(number)}`,
		state: 'OPEN',
		body,
		url: `https://github.com/joshuafolkken/kit/issues/${String(number)}`,
		createdAt: CREATED_AT,
		authorAssociation: 'OWNER',
		author: { login: 'joshuafolkken', type: 'User' },
		labels: { nodes: [] },
		blockedBy: { totalCount: 0, nodes: [] },
	}
}

const run_board_watch_rank_fixture = { issue_node }

export { run_board_watch_rank_fixture }
