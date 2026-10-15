import { has_label_name, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import type { LaneInfo } from '#scripts/lane/lane-registry'

// The open lanes an earlier invocation dispatched that still claim their issue: `in-progress`, and not
// stopped for a person's review. Their unit may have died across the hand-off, so the drive collects
// them; a lane parked or held for review is a person's and is left alone.

async function is_claimed(issue: string): Promise<boolean> {
	const read = await issue_state_cli.read_issue(issue)

	if (read.kind !== 'state') return false

	return has_label_name(read.state.labels, IN_PROGRESS_LABEL) && !read.state.is_human_review
}

async function carried(lanes: ReadonlyArray<LaneInfo>): Promise<ReadonlyArray<string>> {
	const dispatched = lanes.filter((lane) => lane.output !== undefined).map((lane) => lane.issue)
	const claims = await Promise.all(dispatched.map(async (issue) => await is_claimed(issue)))

	return dispatched.filter((_issue, index) => claims[index] === true)
}

const backlog_drive_carried = { carried }

export { backlog_drive_carried }
