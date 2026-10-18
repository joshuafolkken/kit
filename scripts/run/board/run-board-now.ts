import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_board_labels } from './run-board-labels'
import type { LaneEvent } from './run-board-lane-event'
import { run_board_operation, type Operation } from './run-board-operation'
import type { SessionOperations } from './run-board-operation-read'
import type { RunActivity } from './run-board-status'

// The header's third line: what the run is doing now, as its kind, when it happened and its words.
// Always one line while the stream holds an event — the newer of a running child's newest operation and
// its newest event, or the newest operation of the session a stage is the work of, else the stage the
// run is at, else how many children run, else how long it has watched, each of the last three with why;
// an ended run keeps the newest thing it did. **An operation changes with every call a session makes**,
// where a stage or a count stands for minutes. Every time is an event's or a call's own, so the line
// never guesses one; the header ages it and draws it in its time column (joshuafolkken/kit#3767).

const { KIND_BLANK, NOW_ICONS, PHASE_ICONS, STAGE_ICONS, STATE_ICONS, WORDS } = run_board_labels
const { STAGE } = run_event_setup
const REASON_SEPARATOR = ' — '
const OPERATION_SEPARATOR = ' · '
const WORD_SEPARATOR = ' '
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

interface NowLine {
	// The kind's icon, drawn under the `💪`.
	icon: string
	// The icon's word in the legend, `undefined` where the line's own words or the phase legend name it.
	legend?: string | undefined
	// How long ago what the line says happened — up to an ended run's end — `undefined` where no event
	// gave it a time.
	age_ms: number | undefined
	text: string
}

// A line before it is aged: when what it says happened.
type TimedLine = Omit<NowLine, 'age_ms'> & { since_ms: number | undefined }

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

function with_reason(line: string, read: NowRead): string {
	const reason = reason_of(read)

	return reason === undefined ? line : `${line}${REASON_SEPARATOR}${reason}`
}

// The newest thing an ended run did.
function latest_line(read: NowRead): TimedLine | undefined {
	const { latest } = read.activity

	if (latest === undefined) return undefined

	return { icon: NOW_ICONS.ended, legend: WORDS.ended, since_ms: latest.at_ms, text: latest.text }
}

// A run with nothing running and at no stage is watching its pool, since the newest thing it did — a
// stage it has left included, so a judgment session's minutes are not counted as watching.
function watch_line(read: NowRead): TimedLine | undefined {
	const { idle_ms } = read.activity

	if (idle_ms === undefined) return undefined

	return { icon: NOW_ICONS.watching, since_ms: idle_ms, text: with_reason(WORDS.watching, read) }
}

// `words`, then what the session did — words that end on a command or a path.
function operated(words: string, operation: Operation): string {
	return `${words}${OPERATION_SEPARATOR}${run_board_operation.words_of(operation)}`
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

// A stage's icon, keyed by its words before the issue a lane's stage names; a stage the board does not
// know keeps the icon's columns blank, so its words start where every other line's do.
function stage_icon(setup: string): string {
	const known = Object.keys(STAGE_ICONS).find(
		(words) => setup === words || setup.startsWith(`${words}${WORD_SEPARATOR}`),
	)

	return (known === undefined ? undefined : STAGE_ICONS[known]) ?? KIND_BLANK
}

// The stage, then what its session last did and when; the stage, since when the run has stood there
// and why where no session is at work on it, or none could be read.
function stage_line(read: NowRead, setup: string): TimedLine {
	const operation = stage_operation(read, setup)
	const icon = stage_icon(setup)

	return operation === undefined
		? { icon, since_ms: read.activity.setup_ms, text: with_reason(setup, read) }
		: { icon, since_ms: operation.at_ms, text: operated(setup, operation) }
}

// A running child's words, named by its issue.
function child_said(issue: number, words: string): string {
	return `${issue_cite.plain(issue)}${OPERATION_SEPARATOR}${words}`
}

// What the running children's newest activity is read from: each session's newest operation and each
// child's newest event, kept to the children named.
interface ChildSources {
	operations?: SessionOperations | undefined
	lane_events?: ReadonlyMap<number, LaneEvent> | undefined
	children?: ReadonlySet<number> | undefined
}

// The running children's newest operations, each named by its issue.
function operation_lines(read: ChildSources): Array<TimedLine> {
	const lanes = read.operations?.lanes.filter((lane) => read.children?.has(lane.issue)) ?? []

	return lanes.map(({ issue, operation }) => ({
		icon: NOW_ICONS.operation,
		legend: WORDS.operation,
		since_ms: operation.at_ms,
		text: child_said(issue, run_board_operation.words_of(operation)),
	}))
}

// The running children's newest events, each in its row's phase icon and its own words.
function event_lines(read: ChildSources): Array<TimedLine> {
	const events = [...(read.lane_events ?? [])]

	return events
		.filter(([issue]) => read.children?.has(issue))
		.map(([issue, event]) => ({
			icon: PHASE_ICONS[event.phase],
			since_ms: event.at_ms,
			text: child_said(issue, event.words),
		}))
}

function newest_first(left: TimedLine, right: TimedLine): number {
	return (right.since_ms ?? 0) - (left.since_ms ?? 0)
}

// The newest of the children's operations and events — an operation where the two are as new.
// `undefined` where neither could be read. A row reads its own child's the same way
// (joshuafolkken/kit#3769), so the header and the row never disagree on what is newest.
function newest_of(sources: ChildSources): TimedLine | undefined {
	return [...operation_lines(sources), ...event_lines(sources)].toSorted(newest_first).at(0)
}

// The running children's newest, or `undefined`, and the line counts the children instead.
function child_line(read: NowRead): TimedLine | undefined {
	const { operations, children, activity } = read

	return newest_of({ operations, children, lane_events: activity.lane_events })
}

function quiet_line(read: NowRead): TimedLine | undefined {
	if (read.running === 0) return watch_line(read)

	return { icon: STATE_ICONS.running, since_ms: undefined, text: running_of(read.running) }
}

function timed_line(read: NowRead): TimedLine | undefined {
	const { is_stopped, setup } = read.activity

	if (is_stopped) return latest_line(read)
	if (setup !== undefined) return stage_line(read, setup)

	return child_line(read) ?? quiet_line(read)
}

// The line aged to now, or to an ended run's end: an age counting on after it would read as a hang.
function line_of(read: NowRead): NowLine | undefined {
	const line = timed_line(read)

	if (line === undefined) return undefined

	const { since_ms, ...rest } = line
	const until_ms = read.ended_ms ?? read.now_ms

	return { ...rest, age_ms: since_ms === undefined ? undefined : until_ms - since_ms }
}

const run_board_now = { line_of, newest_of }

export { run_board_now }
export type { ChildSources, NowLine, NowRead, TimedLine }
