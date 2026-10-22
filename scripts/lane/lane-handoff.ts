import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
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

// A detached ship for `issue` launched at or after `since_ms` ended in success — it merged, so no cut
// hand-off follows it. The record outlives its run until the next `ship --detach` replaces it, so a
// success launched earlier belongs to a past dispatch of the issue and never counts.
function is_ship_succeeded(issue: string, directory: string, since_ms: number): boolean {
	const repository = git_common_directory.repository(directory)
	const reading =
		repository === undefined ? undefined : run_ship_detach.read_result(repository, issue)

	return reading?.result === 'success' && (reading.launched_at ?? since_ms - 1) >= since_ms
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

// The live ship for `issue` is inside `josh followup`: it waits on CI, CodeRabbit and the merge alone
// (joshuafolkken/kit#4466). The mark is down while the followup stage merges and gates again, after a
// stop, and once a successor supervisor opens the record (`run_ship_stage.read_merge_waiting`).
function is_merge_waiting(repository: string, issue: string, read: StartRead): boolean {
	if (run_ship_detach.read_result(repository, issue, read)?.result !== 'running') return false

	return run_ship_stage.read_merge_waiting(run_ship_stage.record_path(repository, issue))
}

// `is_merge_waiting` for this checkout, read the way `ship_reader` reads.
async function merge_wait_reader(read: StartRead): Promise<(issue: string) => boolean> {
	const repository = await read_repository()

	return (issue) => repository !== undefined && is_merge_waiting(repository, issue, read)
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

const lane_handoff = {
	is_handed_off,
	is_ship_running,
	is_ship_succeeded,
	merge_wait_reader,
	ship_reader,
	ship_running_since,
}

export { lane_handoff }
