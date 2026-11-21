import { has_label_name, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { josh_command } from '#scripts/josh/josh-run'
import { process_identity } from '#scripts/josh/process-identity'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state } from '#scripts/lane/lane-state'
import type { LaneRun } from '#scripts/lane/lane-state-record'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'

// The open lanes an earlier invocation dispatched that still claim their issue: `in-progress`, and not
// stopped for a person's review. Their unit may have died across the hand-off, so the drive collects
// them; a lane parked or held for review is a person's and is left alone.

const RESUME_COMMAND = 'lane:resume'

async function is_claimed(issue: string): Promise<boolean> {
	const read = await issue_state_cli.read_issue(issue)

	if (read.kind !== 'state') return false

	return has_label_name(read.state.labels, IN_PROGRESS_LABEL) && !read.state.is_human_review
}

function is_ended(run: LaneRun, directory: string): boolean {
	if (run_carry_ended.has_ended(run_carry_ended.ended_path(directory), run.started_at)) return true

	return (
		run.owner_pid !== undefined &&
		process_identity.is_same_process(run.owner_pid, undefined) === false
	)
}

async function resume_stopped(issue: string, directory: string): Promise<void> {
	const record = await lane_state.read_state(issue, directory)

	if (record?.state !== 'paused' || record.run === undefined || !is_ended(record.run, directory)) {
		return
	}

	const result = await josh_command.josh_run([RESUME_COMMAND, issue], true)

	console.error(result.out)
	josh_command.require_success(result, RESUME_COMMAND)
}

async function resume_carried(issues: ReadonlyArray<string>): Promise<void> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return

	await Promise.all(
		issues.map(async (issue) => {
			await resume_stopped(issue, directory)
		}),
	)
}

async function carried(lanes: ReadonlyArray<LaneInfo>): Promise<ReadonlyArray<string>> {
	const dispatched = lanes.filter((lane) => lane.output !== undefined).map((lane) => lane.issue)
	const claims = await Promise.all(dispatched.map(async (issue) => await is_claimed(issue)))

	const claimed = dispatched.filter((_issue, index) => claims[index] === true)

	await resume_carried(claimed)

	return claimed
}

const backlog_drive_carried = { carried }

export { backlog_drive_carried }
