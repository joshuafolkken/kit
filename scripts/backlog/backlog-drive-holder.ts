import { has_label_name, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_hold_live } from '#scripts/run/hold/run-hold-live'

// What says another run already holds an issue the offer handed this drive, read just before its lane
// opens (joshuafolkken/kit#9104). The offer's answer is cached for a minute and a claim made outside the
// run stream moves nothing it is keyed on, so a one-off run that claimed the issue in the primary
// checkout seconds earlier was handed a second worker beside it. Each answer is the reason, or
// `undefined` when nothing holds the issue:
// - **a live hold in the primary checkout naming the issue** — a stale one, its session gone, answers
//   nothing, so the next run still takes over an abandoned claim;
// - **its open lane with a live hold** — a lane whose child ended is the drive's to relaunch, kept;
// - **`in-progress` with no lane**, read fresh — the claim a run outside any lane left.

async function root_holder(issue: string): Promise<string | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	const hold = run_hold_live.live_hold_at(directory)

	return hold?.issue === issue
		? `a run in the primary checkout (pid ${String(hold.pid)}) holds it`
		: undefined
}

function lane_holder(lane: LaneInfo): string | undefined {
	const hold = run_hold_live.live_hold(lane.directory)

	return hold === undefined
		? undefined
		: `a run in its lane ${lane.directory} (pid ${String(hold.pid)}) holds it`
}

async function label_holder(issue: string): Promise<string | undefined> {
	const read = await issue_state_cli.read_issue(issue)

	if (read.kind !== 'state') return undefined

	return has_label_name(read.state.labels, IN_PROGRESS_LABEL)
		? `it carries \`${IN_PROGRESS_LABEL}\` with no lane`
		: undefined
}

async function holder(issue: string): Promise<string | undefined> {
	const root = await root_holder(issue)

	if (root !== undefined) return root

	const lane = await lane_registry.find_open_lane(issue)

	return lane === undefined ? await label_holder(issue) : lane_holder(lane)
}

const backlog_drive_holder = { holder }

export { backlog_drive_holder }
