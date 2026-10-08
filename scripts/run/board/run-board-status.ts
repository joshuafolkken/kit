import { backlog_idle, type IdleWindow } from '#scripts/backlog/backlog-idle'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// What each issue of a run is doing now, read from the run's own event stream and its open lanes
// (joshuafolkken/kit#3430). Local reads only — no `gh` call — so `run:board` can redraw it every few
// seconds; the plan these statuses are laid over is the slow GitHub half.

type ItemState = 'running' | 'merged' | 'parked' | 'done' | 'waiting' | 'human'

interface ItemStatus {
	state: ItemState
	started_ms?: number | undefined
	ended_ms?: number | undefined
	// The seat-free lane label (`lane <N>`) of a running child, when it holds one.
	lane?: string | undefined
	// The last step a running child reported — a PR, a review round, a cut — as its event kind.
	phase?: string | undefined
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
const PHASE_KINDS: ReadonlySet<string> = new Set([
	KIND.PR_OPENED,
	KIND.REVIEW_ROUND,
	KIND.CUT,
	KIND.RESUME,
])

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

function launched(event: RunEvent): ItemStatus {
	return { state: 'running', started_ms: moment(event) }
}

function ended(previous: ItemStatus | undefined, state: ItemState, event: RunEvent): ItemStatus {
	return { state, started_ms: previous?.started_ms, ended_ms: moment(event) }
}

function phased(previous: ItemStatus | undefined, event: RunEvent): ItemStatus {
	return { state: 'running', started_ms: previous?.started_ms, phase: event.kind }
}

// One event folded into the status of the child it names; an event the board does not track keeps it.
function next_status(previous: ItemStatus | undefined, event: RunEvent): ItemStatus | undefined {
	if (event.kind === KIND.CHILD_LAUNCH) return launched(event)

	const ending = ENDING_STATES[event.kind]

	if (ending !== undefined) return ended(previous, ending, event)

	return PHASE_KINDS.has(event.kind) ? phased(previous, event) : previous
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

function is_open(status: ItemStatus | undefined): boolean {
	return status === undefined || status.state === 'running'
}

// Every child the run has touched, with the lane each running child holds. A lane the stream never saw
// launched — a run restored after the stream rolled — still reads as running.
function statuses_of(
	events: ReadonlyArray<RunEvent>,
	lanes: ReadonlyArray<string>,
): ReadonlyMap<number, ItemStatus> {
	const statuses = fold_events(events)

	for (const lane of lanes) {
		const issue = Number(lane)
		const status = statuses.get(issue)

		if (is_open(status)) statuses.set(issue, { state: 'running', ...status, lane: `lane ${lane}` })
	}

	return statuses
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

function activity_of(events: ReadonlyArray<RunEvent>): RunActivity {
	const last = events.at(-1)
	const position = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return {
		last_event_ms: last === undefined ? undefined : moment(last),
		idle: idle_of(events),
		is_stopped: is_run_stop(position),
	}
}

const run_board_status = { activity_of, statuses_of }

export { run_board_status }
export type { ItemState, ItemStatus, RunActivity }
