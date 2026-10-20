import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { lane_child_marker, type MarkerSource } from './lane-child-marker'

type StartRead = (pid: number) => string | undefined

// Whether a lane has handed its post-implementation region to the detached ship.
//
// **A child that ran `pnpm josh ship --detach` waits on nobody when it ends.** The supervisor drives the
// gate, the review and the merge, and notifies on its own outcome, so the `Stop` hook's demand for a
// `confirmation` notify and `lane-park`'s refusal of that notify only bought a "nothing needed"
// Telegram and a wasted turn.
// Both hooks read this one predicate, so they cannot disagree about whether the lane was handed off.
//
// **Running, never merely recorded.** A ship that failed hands its region back to the child, whose
// record then reads `failed`; that child is waiting again and owes the notify, so only a live
// supervisor counts as a hand-off.

// A detached ship for `issue` is live in the repository `directory` belongs to — the single reading
// `lane:await`, `run:merge` and the two stop hooks share.
function is_ship_running(issue: string, directory: string): boolean {
	const repository = git_common_directory.repository(directory)

	return (
		repository !== undefined && run_ship_detach.read_result(repository, issue)?.result === 'running'
	)
}

async function read_repository(): Promise<string | undefined> {
	try {
		return await run_carry.repository_directory()
	} catch {
		return undefined
	}
}

// `is_ship_running` for this checkout, for a reader that must not block its event loop
// (joshuafolkken/kit#4245): the repository is read asynchronously once and every recorded start time
// through `read`, so no answer starts a synchronous process.
async function ship_reader(read: StartRead): Promise<(issue: string) => boolean> {
	const repository = await read_repository()

	return (issue) =>
		repository !== undefined &&
		run_ship_detach.read_result(repository, issue, read)?.result === 'running'
}

// When the detached ship for `issue` that is still live was launched, or `undefined` where none is.
function ship_running_since(issue: string, directory: string): number | undefined {
	const repository = git_common_directory.repository(directory)

	return repository === undefined ? undefined : run_ship_detach.running_since(repository, issue)
}

// This session is the dispatched lane child for `directory` and its own ship is running.
function is_handed_off(directory: string, source: MarkerSource = process.env): boolean {
	const issue = lane_child_marker.marked_issue(source)

	if (issue === undefined || !lane_child_marker.is_child_of(directory, source)) return false

	return is_ship_running(issue, directory)
}

const lane_handoff = { is_handed_off, is_ship_running, ship_reader, ship_running_since }

export { lane_handoff }
