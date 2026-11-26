import { session_cite } from '#scripts/issue/session-cite'
import { lane_state } from '#scripts/lane/lane-state'
import { lane_transition_guards } from '#scripts/lane/lane-transition-guards'
import {
	run_hold,
	type HoldMark,
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

function is_stop_record(read: HoldRead, issue: string): boolean {
	const hold = hold_of(read)

	return hold?.issue === issue && hold.is_halfrun_stop === true
}

function is_halfrun_stop(read: HoldRead, issue: string, is_dirty: boolean): boolean {
	return is_dirty && is_stop_record(read, issue)
}

// The stopping run's own record names its issue, or `new` when it entered as `halfrun new`; a free tree
// is marked as well, since the work to protect is sitting in it either way.
function is_own_record(read: HoldRead, issue: string): boolean {
	const hold = hold_of(read)

	return hold === undefined || hold.issue === issue || hold.issue === run_hold.UNNUMBERED_ISSUE
}

// When the stopping run began: its own record's claim, or the start a stop already marked kept; none on
// a free tree.
function started_of(read: HoldRead): string | undefined {
	const hold = hold_of(read)

	return hold?.started_at ?? hold?.taken_at
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
	const started = { ...mark, started_at: started_of(read) }

	return run_hold.create_stop_hold(target, issue, started) ? MARKED : FOREIGN
}

// The stopped run's record is replaced by the resuming `fullrun`'s or `prrun`'s (`mark`), shared with
// the `prrun` resume.
function take_over(target: string, issue: string, mark: HoldMark): boolean {
	run_hold.release_hold(target)

	return run_hold.create_hold(target, issue, mark)
}

// **An interrupted round is #N's own unmarked record gone stale** (joshuafolkken/kit#8932): a round
// stopped before its `--halfrun-stop` — by a person, or refused it over a test left for later — leaves
// its running record behind with its session ended. Nothing else can pick it up over the uncommitted
// diff, and the board stops drawing the runs that carry on without it. A live one stays `held` and is
// never taken, and neither is a `fullrun` or `prrun` record: re-opening it as a round would drop the
// mark the implementation-cut guard and the board read it by.
function is_halfrun_record(hold: RunHold): boolean {
	return !run_hold.is_stop_marked(hold) && hold.is_fullrun !== true && hold.is_prrun !== true
}

function is_interrupted_record(read: HoldRead, issue: string): boolean {
	return read.kind === 'stale' && read.hold.issue === issue && is_halfrun_record(read.hold)
}

function is_round_record(read: HoldRead, issue: string): boolean {
	return is_stop_record(read, issue) || is_interrupted_record(read, issue)
}

// **A fix round re-opens the stop** (`run:hold <N> --halfrun-round`, joshuafolkken/kit#7494): the person
// came back with fixes, so the stopped record is replaced by a running `halfrun`'s owned by the round's
// session — `run:board` draws the round and `tree:status` names its process — until the round's own
// `--halfrun-stop` marks it again. `MARKED` here is the record written; only #N's own stop or
// interrupted round qualifies.
function reopen_at(target: string, issue: string): StopMark {
	const read = run_hold.read_hold(target)

	if (read.kind === 'unreadable') return UNREADABLE

	if (!is_round_record(read, issue)) return FOREIGN

	run_hold.release_hold(target)

	return run_hold.create_hold(target, issue) ? MARKED : FOREIGN
}

// A stop picked up again is running, so a `human-review` lane is returned to `running` — else lane
// readers count the round's tree as idle while the board draws it running. A lane whose branch or work
// tree is gone stays where it is, with the table's reason printed (joshuafolkken/kit#8829).
async function resume_lane(issue: string, command: string): Promise<void> {
	const lane = await lane_state.read_state(issue)

	if (lane?.state !== 'human-review') return
	const note = await lane_transition_guards.rejection('review-resume', issue)

	if (note === undefined) await lane_state.record_change({ issue, state: 'running', command })
	else console.warn(`${command}: lane ${session_cite.issue(issue)} stays in human-review — ${note}`)
}

async function reopen(target: string, issue: string): Promise<StopMark> {
	const mark = reopen_at(target, issue)

	if (mark === MARKED) await resume_lane(issue, 'run:hold --halfrun-round')

	return mark
}

function no_stop_message(issue: string): string {
	return `run:hold: this tree holds no stopped \`halfrun\` of ${session_cite.issue(issue)}, nor an interrupted round of it whose session ended — a fix round re-opens only those records.`
}

function round_command(issue: string): string {
	return `pnpm josh run:hold ${issue} --halfrun-round`
}

// The way on over a record a round re-opens, for the reports that meet it — `tree:status` and a
// refused claim (`run:entry`); none for any other record, nor for a `halfrun new`'s unnumbered one,
// which has no issue to re-claim it under.
function round_hint(read: HoldRead, issue: string): string | undefined {
	if (issue === run_hold.UNNUMBERED_ISSUE || !is_round_record(read, issue)) return undefined

	return `A run of ${session_cite.issue(issue)} carrying on here re-claims it with \`${round_command(issue)}\`; another issue's run waits until the tree is clean.`
}

// `false` leaves the record untouched, so the ordinary claim that follows decides the tree.
function adopt_at(target: string, issue: string, is_dirty: boolean, mark: HoldMark): boolean {
	if (!is_halfrun_stop(run_hold.read_hold(target), issue, is_dirty)) return false

	return take_over(target, issue, mark)
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

// `command` is the resuming run — `fullrun` or `prrun` — whose mark the new record carries.
async function adopt(issue: string, command: string): Promise<boolean> {
	const target = await hold_target()

	if (target === undefined) return false

	const mark = run_hold.resumed_mark(command)
	const is_adopted = adopt_at(target, issue, await run_hold.is_tree_dirty(), mark)

	if (is_adopted) await resume_lane(issue, 'run:entry')

	return is_adopted
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
	no_stop_message,
	reopen,
	reopen_at,
	round_command,
	round_hint,
	take_over,
}

export type { StopMark }
export { run_halfrun_resume }
