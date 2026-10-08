import { backlog_idle, type IdleWindow } from '#scripts/backlog/backlog-idle'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { ClosedIssue } from './run-board-closed'
import { run_board_phase, type Phase } from './run-board-phase'

// What each issue of a run is doing now, read from the run's own event stream and its open lanes
// (joshuafolkken/kit#3430). Local reads only — no `gh` call — so `run:board` can redraw it every few
// seconds; the plan these statuses are laid over is the slow GitHub half, and so is what a child that
// left the open listing answers when read closed (joshuafolkken/kit#3451).

type ItemState = 'running' | 'merged' | 'parked' | 'done' | 'waiting' | 'human'

interface ItemStatus {
	state: ItemState
	started_ms?: number | undefined
	ended_ms?: number | undefined
	// The seat-free lane label (`lane <N>`) of a running child, when it holds one — the running test reads
	// it; the board no longer draws it (joshuafolkken/kit#3444).
	lane?: string | undefined
	// The furthest phase a running child has reached (`run-board-phase.ts`).
	phase?: Phase | undefined
}

// The run as a whole, read off the same stream.
interface RunActivity {
	last_event_ms: number | undefined
	// The idle watch's window, when the newest one opened after the newest launch.
	idle: IdleWindow | undefined
	// The run's last position is a `stop` that names no child — the run itself ended.
	is_stopped: boolean
}

const KIND = run_event_stream.EVENT_KIND
const ENDING_STATES: Readonly<Partial<Record<string, ItemState>>> = {
	[KIND.MERGE]: 'merged',
	[KIND.PARK]: 'parked',
	[KIND.SPLIT]: 'done',
	[KIND.STOP]: 'done',
}
// A cut or a resume says the child is still running, on whatever phase it had reached.
const CONTINUING_KINDS: ReadonlySet<string> = new Set([KIND.CUT, KIND.RESUME])

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

function launched(event: RunEvent): ItemStatus {
	return { state: 'running', started_ms: moment(event), phase: run_board_phase.LAUNCHED_PHASE }
}

function ended(previous: ItemStatus | undefined, state: ItemState, event: RunEvent): ItemStatus {
	return { state, started_ms: previous?.started_ms, ended_ms: moment(event) }
}

function continued(previous: ItemStatus | undefined): ItemStatus {
	return { state: 'running', started_ms: previous?.started_ms, phase: previous?.phase }
}

// A phase moves only a running child, so a ship's `report` stage after its merge — or a `plan` event
// naming an issue no lane has launched — leaves the status as it was.
function advanced(previous: ItemStatus | undefined, event: RunEvent): ItemStatus | undefined {
	const phase = run_board_phase.phase_of(event)

	if (phase === undefined || previous?.state !== 'running') return previous

	return { ...previous, phase: run_board_phase.later_of(previous.phase, phase) }
}

// One event folded into the status of the child it names; an event the board does not track keeps it.
function next_status(previous: ItemStatus | undefined, event: RunEvent): ItemStatus | undefined {
	if (event.kind === KIND.CHILD_LAUNCH) return launched(event)

	const ending = ENDING_STATES[event.kind]

	if (ending !== undefined) return ended(previous, ending, event)

	return CONTINUING_KINDS.has(event.kind) ? continued(previous) : advanced(previous, event)
}

function fold_events(events: ReadonlyArray<RunEvent>): Map<number, ItemStatus> {
	const statuses = new Map<number, ItemStatus>()

	for (const event of events) {
		const issue = Number(run_event_scope.issue_named(event))
		const status = next_status(statuses.get(issue), event)

		if (status !== undefined && Number.isSafeInteger(issue)) statuses.set(issue, status)
	}

	return statuses
}

// A lane is this run's only when its issue is on the run's stream or in the run's plan
// (joshuafolkken/kit#3442): every lane on the machine read as running, so a lane left over from an
// earlier day was drawn as this run's child.
function is_running_lane(
	issue: number,
	status: ItemStatus | undefined,
	in_run: ReadonlySet<number>,
): boolean {
	if (status === undefined) return in_run.has(issue)

	return status.state === 'running'
}

// Every child the run has touched, with the lane each running child holds. A lane the stream never saw
// launched — a run restored after the stream rolled — still reads as running while its issue is in the
// run's plan (`in_run`).
function statuses_of(
	events: ReadonlyArray<RunEvent>,
	lanes: ReadonlyArray<string>,
	in_run: ReadonlySet<number>,
): ReadonlyMap<number, ItemStatus> {
	const statuses = fold_events(events)

	for (const lane of lanes) {
		const issue = Number(lane)
		const status = statuses.get(issue)

		if (is_running_lane(issue, status, in_run)) {
			statuses.set(issue, { state: 'running', ...status, lane: `lane ${lane}` })
		}
	}

	return statuses
}

// The open listing the plan was read with, and when it was read.
interface OpenRead {
	// `undefined` when the listing was cut short, so absence from it proves nothing.
	open_numbers: ReadonlySet<number> | undefined
	read_ms: number | undefined
	// The children read closed from GitHub (`run-board-closed.ts`), by number.
	closed: ReadonlyMap<number, ClosedIssue>
}

function is_listed_closed(issue: number, read: OpenRead): boolean {
	return read.open_numbers !== undefined && !read.open_numbers.has(issue)
}

// A child launched before the listing was read and missing from it has closed since.
function is_closed_running(issue: number, status: ItemStatus, read: OpenRead): boolean {
	if (status.state !== 'running' || read.read_ms === undefined) return false

	return is_listed_closed(issue, read) && (status.started_ms ?? 0) <= read.read_ms
}

// A close dated before the launch is an earlier life of the issue, not how this run's child ended.
function is_closed_before_launch(status: ItemStatus, closed: ClosedIssue): boolean {
	if (closed.closed_ms === undefined || status.started_ms === undefined) return false

	return closed.closed_ms < status.started_ms
}

// A running child read closed ends when GitHub says it closed, merged or not (joshuafolkken/kit#3451).
function closed_status(
	status: ItemStatus,
	closed: ClosedIssue | undefined,
): ItemStatus | undefined {
	if (closed === undefined || is_closed_before_launch(status, closed)) return undefined

	const state = closed.is_merged ? 'merged' : 'done'

	return { state, started_ms: status.started_ms, ended_ms: closed.closed_ms }
}

function settled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	if (status.state !== 'running') return status

	const from_closed = closed_status(status, read.closed.get(issue))

	if (from_closed !== undefined) return from_closed

	return is_closed_running(issue, status, read)
		? { state: 'done', started_ms: status.started_ms }
		: status
}

// **The stream stays the source of truth; the listing only unsticks it** (joshuafolkken/kit#3442). A child
// whose merge never reached the stream read as running forever, so a running child the plan's open
// listing no longer holds is drawn finished instead — merged and timed once GitHub was read for it
// (joshuafolkken/kit#3451), finished without a time while that read has not answered.
function settle_closed(
	statuses: ReadonlyMap<number, ItemStatus>,
	read: OpenRead,
): ReadonlyMap<number, ItemStatus> {
	return new Map([...statuses].map(([issue, status]) => [issue, settled(issue, status, read)]))
}

function newest_of(events: ReadonlyArray<RunEvent>, kind: string): RunEvent | undefined {
	return events.findLast((event) => event.kind === kind)
}

function idle_of(events: ReadonlyArray<RunEvent>): IdleWindow | undefined {
	const idle = newest_of(events, KIND.IDLE)
	const launch = newest_of(events, KIND.CHILD_LAUNCH)

	if (idle === undefined || (launch !== undefined && launch.pos > idle.pos)) return undefined

	return backlog_idle.parse(idle.text)
}

function is_run_stop(event: RunEvent | undefined): boolean {
	return event?.kind === KIND.STOP && run_event_scope.issue_named(event) === undefined
}

// `is_ended` is a run `run:carry --end` closed (joshuafolkken/kit#3439): its record says it stopped,
// whatever its last event was.
function activity_of(events: ReadonlyArray<RunEvent>, is_ended = false): RunActivity {
	const last = events.at(-1)
	const position = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return {
		last_event_ms: last === undefined ? undefined : moment(last),
		idle: idle_of(events),
		is_stopped: is_ended || is_run_stop(position),
	}
}

const run_board_status = { activity_of, settle_closed, statuses_of }

export { run_board_status }
export type { ItemState, ItemStatus, OpenRead, RunActivity }
