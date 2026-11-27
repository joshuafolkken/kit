import { has_label_name, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_hold_live } from '#scripts/run/hold/run-hold-live'

// What says another run already holds an issue the offer handed this drive, read just before its lane
// opens (joshuafolkken/kit#9104). The offer's answer is cached for a minute and a claim made outside the
// run stream moves nothing it is keyed on, so a one-off run that claimed the issue in the primary
// checkout seconds earlier was handed a second worker beside it. Each answer is the reason, or
// `undefined` when nothing holds the issue:
// - **a live hold in the primary checkout naming the issue** — a stale one, its session gone, is an
//   abandoned claim: it answers nothing and silences the `in-progress` that crash left behind, so the
//   next run still takes it over;
// - **its open lane with a live hold** — a lane whose child ended is the drive's to relaunch, kept;
// - **`in-progress` with no lane**, read fresh — the claim a run outside any lane left.

type RootClaim = { kind: 'live'; reason: string } | { kind: 'abandoned' } | { kind: 'none' }

const NO_CLAIM: RootClaim = { kind: 'none' }
const ABANDONED: RootClaim = { kind: 'abandoned' }

function claim_at(git_folder: string, issue: string): RootClaim {
	const read = run_hold.read_hold(run_hold.hold_path(git_folder))

	if (read.kind === 'stale' && read.hold.issue === issue) return ABANDONED

	const hold = run_hold_live.live_hold_at(git_folder)

	return hold?.issue === issue
		? { kind: 'live', reason: `a run in the primary checkout (pid ${String(hold.pid)}) holds it` }
		: NO_CLAIM
}

async function root_claim(issue: string): Promise<RootClaim> {
	const directory = await run_carry.repository_directory()

	return directory === undefined ? NO_CLAIM : claim_at(directory, issue)
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
	const root = await root_claim(issue)

	if (root.kind === 'live') return root.reason

	const lane = await lane_registry.find_open_lane(issue)

	if (lane !== undefined) return lane_holder(lane)

	return root.kind === 'abandoned' ? undefined : await label_holder(issue)
}

const backlog_drive_holder = { holder }

export { backlog_drive_holder }
