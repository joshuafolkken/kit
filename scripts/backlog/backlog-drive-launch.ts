import { git_stash } from '#scripts/git/stash/git-stash'
import { lane_launch_cli } from '#scripts/lane/lane-launch-cli'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { backlog_drive_launch_pass, type DriveLaunch } from './backlog-drive-launch-pass'
import { backlog_drive_owner } from './backlog-drive-owner'
import { backlog_measure_close } from './backlog-measure-close'

const { MEASURED_LAUNCH } = backlog_drive_launch_pass

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

// An issue its measurement declaration closed takes no lane (`backlog-measure-close.ts`).
async function launch(issue: string, owner: string): Promise<DriveLaunch> {
	await backlog_drive_owner.assert_current(owner)
	if (await backlog_measure_close.closed(issue)) return MEASURED_LAUNCH
	await run_event_setup.emit(run_event_setup.opening_lane(issue))

	const outcome = await lane_launch_cli.launch_lane({ issue, stash: await latest_stash() })

	// A refusal the driver waits out writes nothing else, so the lane's stage is ended here.
	if (outcome.kind !== 'launched') await run_event_setup.emit(run_event_setup.STAGE.NO_CHILD)

	return outcome.kind
}

const backlog_drive_launch = { LATEST_STASH_MESSAGE, launch }

export { backlog_drive_launch }
