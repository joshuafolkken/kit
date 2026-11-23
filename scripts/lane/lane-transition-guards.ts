import { git_command } from '#scripts/git/git-command'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import {
	lane_transition_table,
	type LaneGuard,
	type LaneTransitionEvent,
} from './lane-transition-table'

// **The transition table's guards read outside the lane record, evaluated in one place**
// (joshuafolkken/kit#8777): whether the lane's branch and work tree still exist (the lane list and its
// path), and whether another run's hold stamp owns the primary checkout. Every path that applies a
// guarded event asks here instead of spelling the check itself. The guards read on the record itself
// (`no-record`, `paused-by-*`, `owner-run-ended`, `stop-marker-missing`) stay with the event's writer.

const { GUARD, row_of } = lane_transition_table

interface GuardReaders {
	find_lane: (issue: string) => Promise<LaneInfo | undefined>
	branch_exists: (name: string) => Promise<boolean>
	read_tree_hold: () => Promise<HoldRead>
}

type GuardEvaluator = (issue: string, readers: GuardReaders) => Promise<string | undefined>

async function read_tree_hold(): Promise<HoldRead> {
	const directory = await run_hold.worktree_directory()

	if (directory === undefined) return { kind: 'free' }

	return run_hold.read_hold(run_hold.hold_path(directory))
}

const DEFAULT_READERS: GuardReaders = {
	find_lane: async (issue) => await lane_registry.find_open_lane(issue),
	branch_exists: async (name) => await git_command.branch_exists(name),
	read_tree_hold,
}

/** Why a lane has no work tree on `branch` to run in, or `undefined` when it has. */
function work_tree_reason(
	lane: LaneInfo | undefined,
	branch: string | undefined,
): string | undefined {
	if (lane === undefined) return 'it has no lane'
	if (lane.is_stranded) return 'its work tree is gone'

	return lane.branch === branch ? undefined : `its branch ${lane.branch} is gone`
}

/** Whether `lane` is a lane whose work tree is checked out on the existing `branch`. */
function has_work_tree(lane: LaneInfo | undefined, branch: string): lane is LaneInfo {
	return work_tree_reason(lane, branch) === undefined
}

// The claimant's own hold — a child run outside a lane — is not another run's. **An unreadable record
// rejects too**: it has not established that nothing runs here.
function checkout_reason(read: HoldRead, claimant: string): string | undefined {
	if (read.kind === 'unreadable') return 'its run hold record is unreadable'
	if (read.kind !== 'held' || run_hold.is_own_hold(read.hold, claimant)) return undefined

	return `it is held by ${run_hold.describe_holder(read.hold)}`
}

async function evaluate_work_tree(
	issue: string,
	readers: GuardReaders,
): Promise<string | undefined> {
	const lane = await readers.find_lane(issue)
	const is_present = lane !== undefined && (await readers.branch_exists(lane.branch))

	return work_tree_reason(lane, is_present ? lane.branch : undefined)
}

async function evaluate_checkout(
	issue: string,
	readers: GuardReaders,
): Promise<string | undefined> {
	return checkout_reason(await readers.read_tree_hold(), issue)
}

const EVALUATORS: Partial<Record<LaneGuard, GuardEvaluator>> = {
	[GUARD.WORK_TREE]: evaluate_work_tree,
	[GUARD.CHECKOUT_FREE]: evaluate_checkout,
}

/** The first evaluated guard of `event` that `issue`'s lane fails, as its reason, or `undefined`. */
async function rejection(
	event: LaneTransitionEvent,
	issue: string,
	readers: GuardReaders = DEFAULT_READERS,
): Promise<string | undefined> {
	for (const guard of row_of(event).guards) {
		// eslint-disable-next-line no-await-in-loop -- the first failing guard decides; later reads are skipped
		const reason = await EVALUATORS[guard]?.(issue, readers)

		if (reason !== undefined) return reason
	}

	return undefined
}

const lane_transition_guards = { has_work_tree, rejection }

export { lane_transition_guards }
export type { GuardReaders }
