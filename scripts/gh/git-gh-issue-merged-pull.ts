import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { git_gh_issue_graphql } from './git-gh-issue-graphql'
import { git_gh_transport } from './git-gh-transport'

// The head branch of the merged pull request that closes an issue — the pull request a hand merge left
// behind once the checkout is back on the default branch and the head branch is gone
// (joshuafolkken/kit#7646). Only GitHub's closing reference names it: the branch is no longer anywhere
// the checkout can read.
//
// **`undefined` answers "not found"**: a REST session, a failed query, a repository the checkout cannot
// name, or no merged pull request from this repository closing the issue. The caller then keeps the
// branch it had.

const CLOSING_PULLS_LIMIT = 10

const CLOSING_PULLS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		issue(number: $number) {
			closedByPullRequestsReferences(first: ${String(CLOSING_PULLS_LIMIT)}, includeClosedPrs: true) {
				nodes { merged mergedAt isCrossRepository headRefName }
			}
		}
	}
}`

const closing_pull_schema = z.looseObject({
	merged: z.boolean(),
	mergedAt: z.string().nullish(),
	isCrossRepository: z.boolean(),
	headRefName: z.string(),
})
const closing_pulls_schema = z.looseObject({ nodes: z.array(closing_pull_schema) })
const issue_schema = z.looseObject({ closedByPullRequestsReferences: closing_pulls_schema })
const repository_schema = z.looseObject({ issue: issue_schema })
const response_schema = z.looseObject({ data: z.looseObject({ repository: repository_schema }) })

type ClosingPull = z.infer<typeof closing_pull_schema>

function merged_time_of(pull: ClosingPull): number {
	return Date.parse(pull.mergedAt ?? '')
}

// **The latest merge wins**: an issue reopened after one merged pull request and closed by another is
// followed up for the one just merged. GitHub does not promise the references' order.
function merged_head_of(pulls: ReadonlyArray<ClosingPull>): string | undefined {
	return pulls
		.filter((pull) => pull.merged && !pull.isCrossRepository)
		.toSorted((left, right) => merged_time_of(right) - merged_time_of(left))[0]?.headRefName
}

async function pr_merged_head_of_issue(issue_number: string): Promise<string | undefined> {
	const repository = git_gh_issue_graphql.repository_variables_of()
	if (repository === undefined) return undefined

	const json = await git_gh_transport.query({
		query: CLOSING_PULLS_QUERY,
		variables: { ...repository, number: Number(issue_number) },
	})
	if (json === undefined) return undefined

	const parsed = json_value.parse_with(json, response_schema)

	return merged_head_of(parsed?.data.repository.issue.closedByPullRequestsReferences.nodes ?? [])
}

const git_gh_issue_merged_pull = { pr_merged_head_of_issue }

export { git_gh_issue_merged_pull }
