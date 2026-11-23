import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import { backlog_triage_approval } from '#scripts/backlog/backlog-triage-approval'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_auto } from '#scripts/lane/lane-plan-auto'
import { shell_quote } from '#scripts/lib/shell-quote'

// The `lane:plan` command a lane child runs before its first edit — `lane-plan-guard.ts` refuses that
// edit until the plan is cleared. joshuafolkken/kit#4910's child retried a refused Edit eight times
// before it ran `lane:plan`, since nothing it read named the step first (joshuafolkken/kit#4923).
// The paths are its plan comment's; with none, the child names its own. A size approval the parent
// wrote by `backlog:triage --adopt` is named as `--size-approval` (joshuafolkken/kit#6776), ahead of
// the `--imports` the child appends, which takes every argument after it.

async function command_for(issue_number: string, issue: number): Promise<string> {
	const command = lane_plan_auto.command_of(
		issue_number,
		await backlog_plan_comment.plan_paths(issue),
	)
	const approval = await backlog_triage_approval.existing_file(issue_number)

	return approval === undefined
		? command
		: `${command} --size-approval ${shell_quote.word(approval)}`
}

// Nine lanes in ten stopped once on `metrics-totals` for a growth their plan already foresaw, since
// only a growth already measured could be accepted (joshuafolkken/kit#8860).
const EXPECT_HINT =
	'Before the first gate, declare each total this Issue grows (`scripts.code_lines`, `ai_cost.on_demand_bytes`, …) so `metrics-totals` does not stop on it: pnpm josh metrics --expect <total>=<growth> --reason "<why>"'

// The lines to print under `implement` — the command and `lane_plan_auto`'s `--imports` hint while the
// plan is not cleared, then the metrics declaration hint — or none when not a lane child.
async function lines_for(
	issue_number: string,
	is_lane_child: boolean,
): Promise<ReadonlyArray<string>> {
	if (!is_lane_child) return []

	const issue = Number(issue_number)

	if (!lane_plan.is_uncleared(issue, process.cwd())) return [EXPECT_HINT]

	return [await command_for(issue_number, issue), lane_plan_auto.IMPORTS_HINT, EXPECT_HINT]
}

const run_step_lane_plan = { EXPECT_HINT, lines_for }

export { run_step_lane_plan }
