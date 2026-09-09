import { existsSync, rmSync } from 'node:fs'
import { git_command } from '#scripts/git/git-command'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'

// Closing a lane: no work tree, no branch, no directory (joshuafolkken/kit#1490).
//
// **A lane is closed after a park, a failure or an interruption as readily as after a success**, so
// every step here is written to run over a subject that is already gone or that still holds
// uncommitted work. A close that refused either would leave exactly the debris it exists to remove,
// and the next lane for that issue would then fail on a directory nobody could account for. There
// is no ledger entry to remove: the lane's seat lived in the `.env` that goes with the work tree.

interface LaneTargets {
	directory: string
	branch: string
}

type CloseKind = 'closed' | 'incomplete' | 'none'

interface CloseOutcome {
	issue: string
	kind: CloseKind
	left_behind: Array<string>
}

interface SweepOutcome {
	closed: Array<string>
	failed: Array<string>
}

async function ignore_failure(action: () => Promise<string>): Promise<void> {
	try {
		await action()
	} catch {
		// Expected on every path this command was written for: a work tree git no longer registers, a
		// branch already deleted, a prune with nothing to prune. What matters is that the next step
		// still runs — the outcome is judged by what is left on disk, not by these exit codes.
	}
}

// Without a registration — the state a crash between `worktree add` and the `.env` write leaves —
// the issue number still implies both paths, which is what makes such a lane closable at all.
function lane_targets(root: string, issue: string, lane: LaneInfo | undefined): LaneTargets {
	return {
		directory: lane?.directory ?? lane_paths.lane_directory(root, issue),
		branch: lane?.branch ?? lane_paths.lane_branch(issue),
	}
}

// A directory that will not go — a permission, a busy mount — is left for the check below to report
// rather than thrown out of the middle of the removal, where it would abandon the steps after it
// and, inside a sweep, every lane after this one.
function remove_directory(directory: string): void {
	try {
		rmSync(directory, { force: true, recursive: true })
	} catch {
		// Reported by `residue`, which is what judges the close.
	}
}

// **The order is load bearing.** `worktree remove` unregisters and deletes in one step; the explicit
// removal after it covers a tree git had already forgotten; `prune` covers the opposite case, a
// registration whose directory someone deleted by hand; and the branch goes last, because git
// refuses to delete one that is still checked out in a registered work tree.
async function remove_lane(targets: LaneTargets): Promise<void> {
	await ignore_failure(async () => await git_worktree.worktree_remove(targets.directory))
	remove_directory(targets.directory)
	await ignore_failure(async () => await git_worktree.worktree_prune())
	await ignore_failure(async () => await git_worktree.branch_delete(targets.branch))
}

/**
 * What the removal left behind — the empty list is what "closed" means.
 *
 * **The verdict comes from the end state, not from the exit codes above**, every one of which is
 * expected to fail on some legitimate path. The branch is the case that matters: one git refused to
 * delete survives, the next `lane:open` for that issue dies on `worktree add` with git's own message
 * instead of this command's, and a close that had reported success said nothing about it.
 */
async function residue(targets: LaneTargets): Promise<Array<string>> {
	const left: Array<string> = []

	if (existsSync(targets.directory)) left.push(targets.directory)
	if (await git_command.branch_exists(targets.branch)) left.push(targets.branch)

	return left
}

function close_kind(did_exist: boolean, left_behind: ReadonlyArray<string>): CloseKind {
	if (left_behind.length > 0) return 'incomplete'

	return did_exist ? 'closed' : 'none'
}

// The main work tree's root, not this one's — the same reading `list_lanes` uses, so the fallback
// directory an unregistered lane is closed by is the one `lane:open` would have created
// (joshuafolkken/kit#1497). Derived here from the current work tree, a close run inside a lane
// reports `none` over a directory that is still on disk.
async function lane_root_directory(): Promise<string> {
	return lane_paths.lane_root(await lane_registry.main_repository_root())
}

/**
 * Close the lane for `issue`. `none` means there was nothing there, which is not a failure: a caller
 * cleaning up after an interruption cannot know whether the lane was ever opened. `incomplete` means
 * something survived the removal, and `left_behind` names it.
 */
async function close_lane(issue: string): Promise<CloseOutcome> {
	const root = await lane_root_directory()
	const lanes = await lane_registry.list_lanes()
	const existing = lane_registry.find_lane(lanes, issue)
	const targets = lane_targets(root, issue, existing)
	const did_exist = existing !== undefined || existsSync(targets.directory)

	await remove_lane(targets)

	const left_behind = await residue(targets)

	return { issue, kind: close_kind(did_exist, left_behind), left_behind }
}

// A lane that could not be closed is recorded rather than thrown: a sweep has to attempt every lane,
// and the caller has to be told which ones are still there.
async function try_close(issue: string): Promise<boolean> {
	try {
		const outcome = await close_lane(issue)

		return outcome.kind !== 'incomplete'
	} catch {
		return false
	}
}

// Sequential on purpose: two `git worktree` writes at once contend for the same registration
// directory, and the whole point of the command is that nothing is left half-removed.
async function close_each(issues: ReadonlyArray<string>): Promise<SweepOutcome> {
	const sweep: SweepOutcome = { closed: [], failed: [] }

	for (const issue of issues) {
		const bucket = (await try_close(issue)) ? sweep.closed : sweep.failed

		bucket.push(issue)
	}

	return sweep
}

/**
 * Close every lane whose work tree is no longer on disk — the route out of an interruption that took
 * the directory with it and left git's registration behind.
 */
async function prune_lanes(): Promise<SweepOutcome> {
	const lanes = await lane_registry.list_lanes()
	const stranded = lanes.filter((lane) => lane.is_stranded)

	return await close_each(stranded.map((lane) => lane.issue))
}

async function close_all_lanes(): Promise<SweepOutcome> {
	const lanes = await lane_registry.list_lanes()

	return await close_each(lanes.map((lane) => lane.issue))
}

const lane_close = {
	close_all_lanes,
	close_lane,
	lane_root_directory,
	lane_targets,
	prune_lanes,
	remove_lane,
}

export type { CloseKind, CloseOutcome, LaneTargets, SweepOutcome }
export { lane_close }
