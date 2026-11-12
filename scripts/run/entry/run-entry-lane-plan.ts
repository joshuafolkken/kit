import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_auto } from '#scripts/lane/lane-plan-auto'
import { run_stage, type StageState } from '#scripts/run/run-stage'

// **A lane child entering a `kickoff`-planned issue runs `lane:plan` at the entry** (joshuafolkken/kit#5741):
// it never calls `issue:plan`, where joshuafolkken/kit#5738 runs it, so the paths its plan comment names
// are declared here rather than in a separate `lane:plan` call `run:step` prints. A plan with no
// path it can read runs nothing, and `run:step`'s line stays the step before the first edit.

// True when the entry owes `lane:plan`: a lane child's planned issue whose plan has not cleared.
function is_owed(issue: number, state: StageState): boolean {
	const directory = process.cwd()

	if (state !== run_stage.PLANNED || !lane_child_marker.is_child_of(directory)) return false

	return lane_plan.is_uncleared(issue, directory)
}

// The plan comment the entry runs `lane:plan` on, or `undefined` when none is owed or none is read.
async function plan_to_run(issue_number: string, state: StageState): Promise<string | undefined> {
	const issue = Number(issue_number)

	return is_owed(issue, state) ? await backlog_plan_comment.read_plan(issue) : undefined
}

// `lane:plan`'s exit code on the plan comment's paths, its verdict printed; `undefined` when nothing ran.
async function run_at_entry(issue_number: string, state: StageState): Promise<number | undefined> {
	const plan = await plan_to_run(issue_number, state)

	if (plan === undefined || lane_plan_auto.paths_of(plan).length === 0) return undefined

	return await lane_plan_auto.run_from_plan(issue_number, plan)
}

const run_entry_lane_plan = { run_at_entry }

export { run_entry_lane_plan }
