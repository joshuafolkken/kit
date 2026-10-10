import { git_stash } from '#scripts/git/stash/git-stash'
import { lane_launch_cli, type LaunchOutcome } from '#scripts/lane/lane-launch-cli'
import { backlog_drive_owner } from './backlog-drive-owner'

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

async function launch(issue: string, owner: string): Promise<LaunchOutcome['kind']> {
	await backlog_drive_owner.assert_current(owner)

	const outcome = await lane_launch_cli.launch_lane({ issue, stash: await latest_stash() })

	return outcome.kind
}

const backlog_drive_launch = { LATEST_STASH_MESSAGE, launch }

export { backlog_drive_launch }
