import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_board_labels } from './run-board-labels'
import { run_board_operation, type Operation } from './run-board-operation'
import type { LaneOperation, SessionOperations } from './run-board-operation-read'
import type { RunActivity } from './run-board-status'

// The header's third line: what the run is doing now, in words. Always one line while the stream holds
// an event — the newest operation of the session at work (a running child's, or the session a stage is
// the work of), else the stage the run is at and how long it has stood there, else how many children
// run, else how long it has watched, each of the last three with why; an ended run keeps the newest
// thing it did. **An operation changes with every call a session makes**, where a stage or a count
// stands for minutes. Every time is counted from an event's or a call's own, so the line never guesses
// one.

const { WORDS, stage_span_of } = run_board_labels
const { STAGE } = run_event_setup
const REASON_SEPARATOR = ' — '
const OPERATION_SEPARATOR = ' · '
const AGE_GAP = '  '
// The stages a session is at work on, and whose log says what it does. Every other stage is the
// driver's or the supervisor's own step, which writes no log of calls.
const STAGE_SESSIONS: Readonly<Partial<Record<string, 'owner' | 'judgment'>>> = {
	[STAGE.PLANNING]: 'owner',
	[STAGE.SESSION]: 'judgment',
}

interface NowRead {
	now_ms: number
	// Set once the run has ended: the newest event's age stops there.
	ended_ms: number | undefined
	activity: RunActivity
	// The newest operation of each session of the run, `undefined` where none was read.
	operations?: SessionOperations | undefined
	// The issues of the children running now: a lane left by an earlier run is not this run's work.
	children?: ReadonlySet<number> | undefined
	running: number
	// What the plan has left for the run, `undefined` until the plan is read.
	waiting: number | undefined
	// How many of those wait on a person.
	people: number
}

// What stands behind the pool once nothing runs: nothing, only what a person has to decide, or issues
// the run cannot take yet.
function pool_reason(waiting: number, people: number): string {
	if (waiting === 0) return WORDS.pool_empty

	return waiting === people
		? `${String(waiting)} ${WORDS.on_person}`
		: `${String(waiting)} ${WORDS.waiting}`
}

function running_of(running: number): string {
	return `${String(running)} ${WORDS.in_progress}`
}

// Why the run is where it is: the children it runs, else what its plan has left. Nothing before the
// plan is read.
function reason_of(read: NowRead): string | undefined {
	if (read.running > 0) return running_of(read.running)

	return read.waiting === undefined ? undefined : pool_reason(read.waiting, read.people)
}

// `text`, then how long ago `since_ms` was; no time where no event gave one.
function timed(text: string, since_ms: number | undefined, until_ms: number): string {
	return since_ms === undefined ? text : `${text} ${stage_span_of(until_ms - since_ms)}`
}

function with_reason(line: string, read: NowRead): string {
	const reason = reason_of(read)

	return reason === undefined ? line : `${line}${REASON_SEPARATOR}${reason}`
}

// The newest thing an ended run did, aged to its end: an age counting on would read as a hang.
function latest_line(read: NowRead): string {
	const { latest } = read.activity

	return latest === undefined ? '' : timed(latest.text, latest.at_ms, read.ended_ms ?? read.now_ms)
}

// A run with nothing running and at no stage is watching its pool, since the newest thing it did — a
// stage it has left included, so a judgment session's minutes are not counted as watching.
function watch_line(read: NowRead): string {
	const { idle_ms } = read.activity

	if (idle_ms === undefined) return ''

	return with_reason(timed(WORDS.watching, idle_ms, read.now_ms), read)
}

// `words`, then how long ago the session did it — apart from the words, which end on a command or a
// path. A clock a moment behind the log's reads as now.
function operated(words: string, operation: Operation, now_ms: number): string {
	const age = stage_span_of(Math.max(0, now_ms - operation.at_ms))

	return `${words}${OPERATION_SEPARATOR}${run_board_operation.words_of(operation)}${AGE_GAP}${age}`
}

function session_operation(read: NowRead, setup: string): Operation | undefined {
	const session = STAGE_SESSIONS[setup]

	return session === undefined ? undefined : read.operations?.[session]
}

// The newest operation of the session a stage is the work of. One older than the stage is an earlier
// session's, or what the parent did before it — the watcher's log runs on across runs.
function stage_operation(read: NowRead, setup: string): Operation | undefined {
	const operation = session_operation(read, setup)

	if (operation === undefined) return undefined

	return operation.at_ms < (read.activity.setup_ms ?? 0) ? undefined : operation
}

// The stage, then what its session last did; the stage, how long the run has stood there and why
// where no session is at work on it, or none could be read.
function stage_line(read: NowRead, setup: string): string {
	const operation = stage_operation(read, setup)

	return operation === undefined
		? with_reason(timed(setup, read.activity.setup_ms, read.now_ms), read)
		: operated(setup, operation, read.now_ms)
}

function newest_first(left: LaneOperation, right: LaneOperation): number {
	return right.operation.at_ms - left.operation.at_ms
}

// The newest operation across the running children, named by its issue; `undefined` where no running
// child's log could be read, and the line counts them instead.
function child_line(read: NowRead): string | undefined {
	const lanes = read.operations?.lanes.filter((lane) => read.children?.has(lane.issue)) ?? []
	const [newest] = lanes.toSorted(newest_first)

	if (newest === undefined) return undefined

	return operated(issue_cite.plain(newest.issue), newest.operation, read.now_ms)
}

function quiet_line(read: NowRead): string {
	return read.running > 0 ? running_of(read.running) : watch_line(read)
}

function line_of(read: NowRead): string {
	const { is_stopped, setup } = read.activity

	if (is_stopped) return latest_line(read)
	if (setup !== undefined) return stage_line(read, setup)

	return child_line(read) ?? quiet_line(read)
}

const run_board_now = { line_of }

export { run_board_now }
export type { NowRead }
