import { existsSync, rmSync } from 'node:fs'
import { git_command } from '#scripts/git/git-command'
import { git_worktree } from '#scripts/git/git-worktree'
import { error_text } from '#scripts/lib/error-message'
import { lane_paths } from './lane-paths'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_residents } from './lane-residents'
import { lane_spent, type KeptLane } from './lane-spent'
import { lane_state } from './lane-state'

// Closing a lane: no work tree, no branch, no directory.
//
// **A lane is closed after a park, a failure or an interruption as readily as after a success**, so
// every step here is written to run over a subject that is already gone or that still holds
// uncommitted work. A close that refused either would leave exactly the debris it exists to remove,
// and the next lane for that issue would then fail on a directory nobody could account for. There
// is no ledger entry to remove: the lane's seat lived in the `.env` that goes with the work tree. The
// lane's state record outlives it, marked `ended`, so its last state stays readable.

interface LaneTargets {
	directory: string
	branch: string
}

// The lane an issue number names: its registration, when there is one, and the paths a close acts on.
// Resolved once here so a caller that has to look inside the tree before closing it reads the same
// directory the close removes.
interface ResolvedLane {
	existing: LaneInfo | undefined
	targets: LaneTargets
}

type CloseKind = 'closed' | 'incomplete' | 'none'

interface CloseOutcome {
	issue: string
	kind: CloseKind
	left_behind: Array<string>
	// The lane child's processes this close terminated — empty for a child that ended by itself.
	reaped: Array<number>
	// What else still ran from the lane's checkout or carried its mark and this close terminated
	// (`lane-residents.ts`); `undefined` where the processes could not be read.
	residents: Array<number> | undefined
}

interface SweepOutcome {
	closed: Array<string>
	failed: Array<string>
}

interface PruneOutcome extends SweepOutcome {
	// The live lanes left open, each with the reason it was not discarded.
	kept: Array<KeptLane>
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

// The lane root is the main work tree's (`lane_root_directory`), so the fallback directory an
// unregistered lane is closed by is the one `lane:open` would have created.
/**
 * Close the lane for `issue`. `none` means there was nothing there, which is not a failure: a caller
 * cleaning up after an interruption cannot know whether the lane was ever opened. `incomplete` means
 * something survived the removal, and `left_behind` names it.
 */
async function resolve_lane(issue: string): Promise<ResolvedLane> {
	const root = await lane_registry.lane_root_directory()
	const existing = lane_registry.find_lane(await lane_registry.list_lanes(), issue)

	return { existing, targets: lane_targets(root, issue, existing) }
}

async function close_lane(issue: string): Promise<CloseOutcome> {
	const { existing, targets } = await resolve_lane(issue)
	const did_exist = existing !== undefined || existsSync(targets.directory)
	// Before the removal, not after: a child still running in the tree would keep writing into a
	// directory being deleted, and a process outliving its lane is a half-discarded state — the work
	// tree gone, the child still answering `alive`. What else still runs from the checkout goes too.
	const reaped = lane_reap.reap_child({ issue, directory: targets.directory })
	const residents = lane_residents.end_residents({ issue, directory: targets.directory }, reaped)

	await remove_lane(targets)

	const left_behind = await residue(targets)
	const kind = close_kind(did_exist, left_behind)

	if (kind === 'closed') {
		await lane_state.record_change({ issue, state: 'ended', command: 'lane:close' })
	}

	return { issue, kind, left_behind, reaped, residents }
}

// A lane that could not be closed is recorded rather than thrown: a sweep has to attempt every lane,
// and the caller has to be told which ones are still there.
async function try_close(issue: string): Promise<boolean> {
	try {
		const outcome = await close_lane(issue)

		return outcome.kind !== 'incomplete'
	} catch (error) {
		error_text.trace_swallowed('lane_close.try_close', error)

		return false
	}
}

// Sequential on purpose: two `git worktree` writes at once contend for the same registration
// directory, and the whole point of the command is that nothing is left half-removed.
async function close_each(issues: ReadonlyArray<string>): Promise<SweepOutcome> {
	const sweep: SweepOutcome = { closed: [], failed: [] }

	for (const issue of issues) {
		// eslint-disable-next-line no-await-in-loop -- worktree writes contend for the same registration directory
		const bucket = (await try_close(issue)) ? sweep.closed : sweep.failed

		bucket.push(issue)
	}

	return sweep
}

/**
 * Close every lane nothing needs any more: one whose work tree is no longer on disk — the route out of
 * an interruption that took the directory with it and left git's registration behind — and one a past
 * run left spent (`lane-spent.ts`). A live lane that is not spent is kept, and `kept` says why.
 */
async function prune_lanes(): Promise<PruneOutcome> {
	const lanes = await lane_registry.list_lanes()
	const { spent, kept } = await lane_spent.sort_lanes(lanes)
	const doomed = lanes.filter((lane) => lane.is_stranded || spent.includes(lane))
	const sweep = await close_each(doomed.map((lane) => lane.issue))

	return { ...sweep, kept }
}

async function close_all_lanes(): Promise<SweepOutcome> {
	const lanes = await lane_registry.list_lanes()

	return await close_each(lanes.map((lane) => lane.issue))
}

const lane_close = {
	close_all_lanes,
	close_lane,
	prune_lanes,
	resolve_lane,
}

export type { CloseKind, CloseOutcome, PruneOutcome, ResolvedLane, SweepOutcome }
export { lane_close }
