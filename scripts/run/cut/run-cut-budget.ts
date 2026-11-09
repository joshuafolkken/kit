import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_spill } from '#scripts/issue/issue-spill'
import { session_cite } from '#scripts/issue/session-cite'
import { run_cut_budget_over } from './run-cut-budget-over'
import { run_cut_report } from './run-cut-report'

// Whether a pre-gate cut answers `budget-over` (joshuafolkken/kit#6026): the implementation has run past
// its stage budget (`run-cut-budget-over.ts`) and the Issue already has a green part — at least one
// checked acceptance criterion — to ship while the rest is spilled. Without one there is nothing to
// ship, so the cut goes on as before. Nothing is cut either way: the run ships on this tree.

const BUDGET_OVER_VERDICT = 'budget-over'

async function has_green_part(issue: number): Promise<boolean> {
	const body = await git_gh_issue_read.issue_get_body(String(issue))

	return body !== undefined && issue_spill.checked_count(body) > 0
}

// The minutes over where `issue`'s implementation is past its budget with a green part checked, else
// `undefined`. The Issue body is read only once the budget is over.
async function over_minutes(issue: number): Promise<number | undefined> {
	const over = await run_cut_budget_over.implement_over(issue)

	if (over === undefined) return undefined

	return (await has_green_part(issue)) ? over : undefined
}

function report_over(issue: string, over: number): number {
	console.error(
		`The implementation of ${session_cite.issue(issue)} is ${String(over)} min over its stage budget, so nothing was cut. ${run_cut_budget_over.spill_steps(issue)}`,
	)

	return run_cut_report.report(BUDGET_OVER_VERDICT, run_cut_report.SUCCESS_EXIT_CODE)
}

const run_cut_budget = { BUDGET_OVER_VERDICT, over_minutes, report_over }

export { run_cut_budget }
