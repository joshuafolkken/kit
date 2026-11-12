import { git_stash } from '#scripts/git/stash/git-stash'
import { lane_launch_cli, type LaunchOutcome } from '#scripts/lane/lane-launch-cli'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { backlog_drive_launch_pass, type DriveLaunch } from './backlog-drive-launch-pass'
import { backlog_drive_owner } from './backlog-drive-owner'
import { backlog_drive_split_unit } from './backlog-drive-split-unit'
import { backlog_drive_trace } from './backlog-drive-trace'
import { backlog_measure_close } from './backlog-measure-close'

const { MEASURED_LAUNCH, SPLIT_LAUNCH, UNSAMPLED_LAUNCH } = backlog_drive_launch_pass

// The driver's lane launch. The parent that ran `josh latest` in the primary
// checkout leaves its rewritten lock file in a stash under this message — `backlogrun-lanes.md` →
// "Once per repository, before the first lane opens" — and the lane that pops it carries the update
// into its pull request. **The stash itself is the "first lane" marker**: each launch asks whether it
// is still on the stack, and the pop that `lane:launch --stash` runs consumes it, so the first launch
// after the push takes it and every later one finds nothing. A restarted driver needs no memory of
// which lane was first. Two entries under the message are a state a person resolves, so neither is
// guessed at — the launch goes ahead without one, as `stash:pop` would refuse it anyway. That skip is
// said on stderr, because `stash:pop` refusing would have been heard and a silent skip would let the
// update never reach a pull request.
const LATEST_STASH_MESSAGE = 'backlogrun: josh latest before lanes'

async function latest_stash(): Promise<string | undefined> {
	const selection = git_stash.select(await git_stash.list(), LATEST_STASH_MESSAGE)

	if (selection.kind === 'ambiguous') {
		console.error(
			`Launching without the "${LATEST_STASH_MESSAGE}" stash: ${selection.selectors.join(', ')} all match — keep one.`,
		)
	}

	return selection.kind === 'match' ? LATEST_STASH_MESSAGE : undefined
}

// **One launch at a time holds the stash** (joshuafolkken/kit#5519): a pass's launches run side by
// side, and each asking the stack alone would find the stash every one of them, before any pop. The
// claim is taken before the stack is read and given back when the launch ends, so a pop that refused
// leaves the stash for the next pass's first launch.
const stash_holders = new Set<string>()

async function launch_ready(issue: string): Promise<LaunchOutcome> {
	const { launch_ready_lane } = lane_launch_cli

	if (stash_holders.size > 0) return await launch_ready_lane({ issue, stash: undefined })

	stash_holders.add(issue)

	try {
		return await launch_ready_lane({ issue, stash: await latest_stash() })
	} finally {
		stash_holders.delete(issue)
	}
}

// A refusal's stage keeps the failing step's own explanation after the issue, folded onto the event's
// one line and capped, since the board draws the newest stage whole as its header; the
// `no child launched` prefix the board ends the stage on is unchanged.
const DETAIL_LIMIT = 200

function no_child(issue: string, detail: string | undefined): string {
	const event = run_event_setup.no_child(issue)

	if (detail === undefined) return event

	const folded = detail.replaceAll(/\s+/gu, ' ')
	const capped = folded.length > DETAIL_LIMIT ? `${folded.slice(0, DETAIL_LIMIT)}…` : folded

	return `${event}: ${capped}`
}

// An issue its measurement declaration closed, or that waits for a sample, takes no lane
// (`backlog-measure-close.ts`, which puts the wait on the stream).
async function measured(issue: string): Promise<DriveLaunch | undefined> {
	const outcome = await backlog_measure_close.outcome(issue)

	if (outcome === 'closed') return MEASURED_LAUNCH

	return outcome === 'wait' ? UNSAMPLED_LAUNCH : undefined
}

// An issue over the size bar that its split-only unit split takes no lane either
// (`backlog-drive-split-unit.ts`). The unit runs for minutes, so ownership is asserted again after it:
// a driver superseded meanwhile opens no lane.
async function opened(issue: string, owner: string): Promise<DriveLaunch> {
	await backlog_drive_owner.assert_current(owner)

	const settled = await measured(issue)

	if (settled !== undefined) return settled
	if ((await backlog_drive_split_unit.run(issue)) === 'split') return SPLIT_LAUNCH
	await backlog_drive_owner.assert_current(owner)
	await run_event_setup.emit(run_event_setup.opening_lane(issue))

	const outcome = await launch_ready(issue)

	// A refusal the driver waits out writes nothing else, so the lane's stage is ended here.
	if (outcome.kind !== 'launched' && outcome.kind !== 'waiting') {
		await run_event_setup.emit(no_child(issue, outcome.detail))
	}

	return outcome.kind
}

// The launch opened and closed on the stream (`backlog-drive-trace.ts`).
async function launch(issue: string, owner: string): Promise<DriveLaunch> {
	return await backlog_drive_trace.traced(
		issue,
		backlog_drive_trace.STEP.LAUNCH,
		async () => await opened(issue, owner),
	)
}

const backlog_drive_launch = { LATEST_STASH_MESSAGE, launch }

export { backlog_drive_launch }
