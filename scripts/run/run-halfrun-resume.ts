import {
	run_hold,
	type HoldRead,
	type RunHold,
	type StopMarkFields,
} from '#scripts/run/hold/run-hold'

// A `halfrun` stops before its commit and **keeps** its hold, because the uncommitted, hand-verified
// work is exactly what a second run would trample. The person then types `fullrun #N` to ship it, and
// that run adopts the hold here rather than meeting `busy` from `run:entry`'s claim or being advised
// to stash the verified diff away.
//
// **The stop is recorded, never inferred.** A hold naming #N over a dirty tree is also what a `halfrun`
// still implementing and a `backlogrun` child leave, and adopting either hands a half-written diff to
// the gate and the merge. So the `halfrun` stop re-writes its own record with a stop mark
// (`run:hold <N> --halfrun-stop`) — re-keying a `halfrun new`'s unnumbered record to the issue it filed —
// and only a marked record is adopted. An expired one qualifies too, since a person may verify the next
// day. The adopted record carries the `fullrun` mark instead, so the implementation-cut guard and
// `run:cut --resume` read the tree as this `fullrun`'s from here on.

const MARKED = 'marked'
const FOREIGN = 'foreign'
const UNREADABLE = 'unreadable'

type StopMark = typeof FOREIGN | typeof MARKED | typeof UNREADABLE

function hold_of(read: HoldRead): RunHold | undefined {
	return read.kind === 'held' || read.kind === 'stale' ? read.hold : undefined
}

function is_halfrun_stop(read: HoldRead, issue: string, is_dirty: boolean): boolean {
	const hold = hold_of(read)

	return is_dirty && hold?.issue === issue && hold.is_halfrun_stop === true
}

// The stopping run's own record names its issue, or `new` when it entered as `halfrun new`; a free tree
// is marked as well, since the work to protect is sitting in it either way.
function is_own_record(read: HoldRead, issue: string): boolean {
	const hold = hold_of(read)

	return hold === undefined || hold.issue === issue || hold.issue === run_hold.UNNUMBERED_ISSUE
}

// `mark` is the `halfrun` stop's by default; a `prrun` stop passes its own, so
// the own-record check is one check whichever run is stopping.
function mark_stop_at(
	target: string,
	issue: string,
	mark: StopMarkFields = run_hold.HALFRUN_STOP_FIELDS,
): StopMark {
	const read = run_hold.read_hold(target)

	if (read.kind === 'unreadable') return UNREADABLE

	if (!is_own_record(read, issue)) return FOREIGN

	run_hold.release_hold(target)

	return run_hold.create_stop_hold(target, issue, mark) ? MARKED : FOREIGN
}

// The stopped run's record is replaced by this `fullrun`'s, shared with the `prrun` resume.
function take_over(target: string, issue: string): boolean {
	run_hold.release_hold(target)

	return run_hold.create_hold(target, issue, new Date(), true)
}

// `false` leaves the record untouched, so the ordinary claim that follows decides the tree.
function adopt_at(target: string, issue: string, is_dirty: boolean): boolean {
	if (!is_halfrun_stop(run_hold.read_hold(target), issue, is_dirty)) return false

	return take_over(target, issue)
}

// **An unreadable git directory is no resume**, never a crash: `run:entry` must still print its one
// summary line, and the ordinary claim that follows answers `unknown` for the same tree.
async function hold_target(): Promise<string | undefined> {
	try {
		const directory = await run_hold.worktree_directory()

		return directory === undefined ? undefined : run_hold.hold_path(directory)
	} catch {
		return undefined
	}
}

// Read-only, so `run:entry` can ask the session budget before it takes anything over.
async function is_pending(issue: string): Promise<boolean> {
	const target = await hold_target()

	if (target === undefined) return false

	return is_halfrun_stop(run_hold.read_hold(target), issue, await run_hold.is_tree_dirty())
}

async function adopt(issue: string): Promise<boolean> {
	const target = await hold_target()

	if (target === undefined) return false

	return adopt_at(target, issue, await run_hold.is_tree_dirty())
}

const run_halfrun_resume = {
	FOREIGN,
	MARKED,
	UNREADABLE,
	adopt,
	adopt_at,
	hold_of,
	hold_target,
	is_pending,
	mark_stop_at,
	take_over,
}

export type { StopMark }
export { run_halfrun_resume }
