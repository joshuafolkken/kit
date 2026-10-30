import type { OpenIssueData } from '#scripts/git/git-schemas'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import { split_assess } from '#scripts/split/split-assess'
import type { PoolContext } from './backlog-gate-scope'

// An offered Issue whose declared estimate is over the split guide, with no reason it stays one —
// judged by the same `size_estimate.over_guide` `issue:file` refuses on, so a body edited past the
// guide after filing is still seen before a lane starts it (joshuafolkken/kit#5384).

function route_of(issue: OpenIssueData): string | undefined {
	const is_split = issue.labels?.some((label) => label.name === SPLIT_ROUTE_LABEL) === true

	return is_split ? SPLIT_ROUTE_LABEL : undefined
}

function note_of(issue: OpenIssueData, repo: string): string | undefined {
	const estimate = size_estimate.over_guide(issue.body ?? '', route_of(issue))

	if (estimate === undefined) return undefined
	const cited = session_cite.issue(issue.number, undefined, repo)

	return `${cited} ${size_estimate.exceeded(estimate)} with no \`${split_assess.REASON_PREFIX}\` — split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// One stderr line per offered number over the guide; the stdout tokens stay bare numbers.
function warn_over_guide(tokens: ReadonlyArray<string>, context: PoolContext): void {
	const offered = new Set(tokens)
	const issues = context.opted_in.issues.filter((issue) => offered.has(String(issue.number)))

	for (const issue of issues) {
		const note = note_of(issue, context.repo)

		if (note !== undefined) console.error(note)
	}
}

const backlog_next_size = { warn_over_guide }

export { backlog_next_size }
