import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import { lane_plan } from '#scripts/lane/lane-plan'
import { shell_quote } from '#scripts/lib/shell-quote'

// The `lane:plan` command a lane child runs before its first edit — `lane-plan-guard.ts` refuses that
// edit until the plan is cleared. joshuafolkken/kit#4910's child retried a refused Edit eight times
// before it ran `lane:plan`, since nothing it read named the step first (joshuafolkken/kit#4923).
// The paths are its plan comment's; with none, the child names its own.

const PATH_PLACEHOLDER = '<path>...'

// The command to print under `implement`, or `undefined` when not a lane child or its plan is cleared.
async function line_for(issue_number: string, is_lane_child: boolean): Promise<string | undefined> {
	const issue = Number(issue_number)

	if (!is_lane_child || !lane_plan.is_uncleared(issue, process.cwd())) return undefined

	const paths = await backlog_plan_comment.plan_paths(issue)
	const named =
		paths.length === 0 ? PATH_PLACEHOLDER : paths.map((path) => shell_quote.word(path)).join(' ')

	return `pnpm josh lane:plan ${issue_number} ${named}`
}

const run_step_lane_plan = { line_for }

export { run_step_lane_plan }
