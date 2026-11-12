import type { AgentResult } from '#scripts/agent/agent-event'
import type { IssueOutcome } from '#scripts/issue/issue-outcome'
import type { Span } from '#scripts/lane/lane-spans'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_checks } from './run-board-checks'
import { run_board_closed, type ClosedIssue, type ListingRead } from './run-board-closed'
import { run_board_ending_reason } from './run-board-ending-reason'
import { run_board_ending_states } from './run-board-ending-states'
import { run_board_idle, type IdleSince } from './run-board-idle'
import { run_board_lane_event, type LaneEvent } from './run-board-lane-event'
import type { BoardLanes } from './run-board-lane-state'
import { run_board_lane_stop } from './run-board-lane-stop'
import { run_board_lane_time } from './run-board-lane-time'
import { run_board_phase, type Phase } from './run-board-phase'
import { run_board_settle } from './run-board-settle'
import { run_board_setup, type SetupRead } from './run-board-setup'

// What each issue of a run is doing now, read from the run's own event stream and what each open lane's
// record says (`run-board-lane-state.ts`).
// Local reads only — no `gh` call — so `run:board` can redraw it every few seconds; the plan these
// statuses are laid over is the slow GitHub half, and so is what a child that left the open listing,
// or is drawn stopped, answers when read closed.

type ItemState =
	| 'running'
	| 'paused'
	| 'merged'
	| 'parked'
	| 'done'
	// Closed by `josh issue:already-done` with verified evidence — finished, nothing to merge.
	| 'already_done'
	| 'waiting'
	| 'human'
	| 'stopped'
	| 'withdrawn'
	// An open lane with no lane state record — drawn as unknown, never guessed (joshuafolkken/kit#4269).
	| 'unknown'

interface ItemStatus {
	outcome?: IssueOutcome | undefined
	state: ItemState
	// When the child first launched in this run — a re-dispatch or a restart does not move it.
	started_ms?: number | undefined
	// Each launch of the child in this run until what took it off the lanes (`run-board-lane-time.ts`):
	// the row's time is their sum, not the gaps between them.
	spans?: ReadonlyArray<Span> | undefined
	// The child's newest launch, present only where it launched again after `started_ms` — what the
	// GitHub read is weighed against.
	launched_ms?: number | undefined
	ended_ms?: number | undefined
	// The lane time the event that ended the child recorded (joshuafolkken/kit#4481), where it carries one.
	elapsed_ms?: number | undefined
	// The seat-free lane label (`lane <N>`) of a running child, when it holds one — the running test reads
	// it; the board does not draw it.
	lane?: string | undefined
	// Every phase the child passed while running, in order (`run-board-phase.ts`) — kept once it settles.
	track?: ReadonlyArray<Phase> | undefined
	// When a running child entered the phase its track ends on — the event that moved it there.
	phase_ms?: number | undefined
	// The raw reason the ending event gave; the layout chooses the current stalled resume action.
	reason?: string | undefined
	// The command that paused a paused lane, read off its lane state record (`run-board-lane-state.ts`).
	paused_by?: string | undefined
	// What stopped the lane or its ship — the command its record or its labels name
	// (`run-board-lane-stop.ts`).
	stop_reason?: string | undefined
	// A running lane's transcript result (`run_liveness.read_agent_state`); `undefined` where unread.
	result?: AgentResult | undefined
	// When a running lane's transcript was last written — the latest an idle lane can have stopped.
	written_ms?: number | undefined
}

interface LatestEvent {
	text: string
	at_ms: number
}

// The run as a whole, read off the same stream. The setup half is `run-board-setup.ts`'s, absent
// where a stream carries no stage.
interface RunActivity extends Partial<SetupRead> {
	last_event_ms: number | undefined
	// The newest thing the run did — its newest position, or its newest event where it has none yet —
	// in the event's own words, and when.
	latest?: LatestEvent | undefined
	// When the run last did anything of its own — its newest position or stage, whichever is newer. A
	// stage that has ended still counts: what follows it is counted from its end, not from before it.
	idle_ms?: number | undefined
	// Each child's newest `lane-phase` or `ship-stage`, by issue (`run-board-lane-event.ts`).
	lane_events?: ReadonlyMap<number, LaneEvent> | undefined
	// Each child's newest `pr-checks`, by issue (`run-board-checks.ts`).
	pr_checks?: ReadonlyMap<number, PrChecks> | undefined
	// The newest session's start until its first lane opened (`run-board-first-lane.ts`).
	first_lane_ms?: number | undefined
	// The run's last position is a `stop` that names no child — the run itself ended.
	is_stopped: boolean
}

const KIND = run_event_stream.EVENT_KIND
// A cut or a resume says the child is still running, on whatever phase it had reached.
const CONTINUING_KINDS: ReadonlySet<string> = new Set([KIND.CUT, KIND.RESUME])
// A person's restart, and a re-dispatch after an outage, start the child over in a fresh session, so
// its track starts over too; its time does not (`launched`).
const { LAUNCH_KINDS } = run_board_lane_time
// What the GitHub read may still settle: a running child, and one whose lane has no child left in it —
// a child that merged and then died is drawn merged, not stopped.
const UNSETTLED_STATES: ReadonlySet<ItemState> = new Set(['running', 'paused', 'stopped'])
// A child waiting on a person — parked, or stopped for human review — is drawn in 🙋 decision. The
// person may close its issue after the stop; only a closed read settles it again, so one still open
// keeps waiting whatever its labels say (joshuafolkken/kit#3958).
const WAITING_STATES: ReadonlySet<ItemState> = new Set(['parked', 'human'])

const { relaunch_of, settled_as } = run_board_settle

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

// joshuafolkken/kit#3971: a launch keeps the start of the child's first one in this run.
function launched(previous: ItemStatus | undefined, event: RunEvent): ItemStatus {
	const at_ms = moment(event)
	const started_ms = previous?.started_ms ?? at_ms

	return {
		state: 'running',
		started_ms,
		...(started_ms !== at_ms && { launched_ms: at_ms }),
		track: [run_board_phase.LAUNCHED_PHASE],
		phase_ms: at_ms,
	}
}

// The status with its track moved on by `event`. The phase's start moves only where the phase the
// track ends on changes, so a second session's first edit does not restart the time of its phase.
function moved(previous: ItemStatus, track: ReadonlyArray<Phase>, event: RunEvent): ItemStatus {
	const is_same = previous.phase_ms !== undefined && track.at(-1) === previous.track?.at(-1)

	return { ...previous, track, phase_ms: is_same ? previous.phase_ms : moment(event) }
}

// A bare ending that repeats the one before keeps that one's reason: `run:merge` writes a bare park
// after the ship-stop cap's park named its cause (joshuafolkken/kit#5780).
function kept_reason(
	previous: ItemStatus | undefined,
	state: ItemState,
): Pick<ItemStatus, 'reason'> {
	return previous?.state === state && previous.reason !== undefined
		? { reason: previous.reason }
		: {}
}

function ended(previous: ItemStatus | undefined, state: ItemState, event: RunEvent): ItemStatus {
	return {
		...settled_as(previous, state),
		ended_ms: moment(event),
		...kept_reason(previous, state),
		...run_board_ending_reason.recorded_of(event),
	}
}

// A cut or a resume carries on a child the stream already holds; with none it says nothing, so no
// status is made from it alone (joshuafolkken/kit#4269).
function continued(previous: ItemStatus | undefined): ItemStatus | undefined {
	if (previous === undefined) return undefined

	const { started_ms, track, phase_ms } = previous

	return { state: 'running', started_ms, ...relaunch_of(previous), track, phase_ms }
}

// A stage line carrying its attempt redraws the track of any child launched on this stream — a settled
// one too, since the line that survived a full stream is often the `report` after the merge — and
// starts one for a running child whose launch has rolled off.
function replayed(
	previous: ItemStatus | undefined,
	attempt: ReadonlyArray<Phase>,
	event: RunEvent,
): ItemStatus | undefined {
	if (previous === undefined) return previous
	if (previous.track === undefined && previous.state !== 'running') return previous

	return moved(previous, run_board_phase.replayed(previous.track ?? [], attempt), event)
}

// A phase moves only a running child, so a three-word `report` stage after its merge — or a `plan`
// event naming an issue no lane has launched — leaves the status as it was.
function phased(previous: ItemStatus | undefined, event: RunEvent): ItemStatus | undefined {
	const phase = run_board_phase.phase_of(event)

	if (phase === undefined || previous?.state !== 'running') return previous

	return moved(previous, run_board_phase.history_after(previous.track ?? [], phase), event)
}

function advanced(previous: ItemStatus | undefined, event: RunEvent): ItemStatus | undefined {
	const attempt = run_board_phase.attempt_of(event)

	return attempt === undefined ? phased(previous, event) : replayed(previous, attempt, event)
}

// One event folded into the status of the child it names; an event the board does not track keeps it.
function next_status(previous: ItemStatus | undefined, event: RunEvent): ItemStatus | undefined {
	if (run_event_retry.is_retry(event)) return settled_as(previous, 'waiting')
	if (LAUNCH_KINDS.has(event.kind)) return launched(previous, event)

	const ending = run_board_ending_states.STATES[event.kind]

	if (ending !== undefined) return ended(previous, ending, event)

	return CONTINUING_KINDS.has(event.kind) ? continued(previous) : advanced(previous, event)
}

// A yielded lane's close hands its child back to the queue untouched, so its next launch starts it over.
function fold_event(statuses: Map<number, ItemStatus>, event: RunEvent): void {
	const issue = Number(run_event_scope.issue_named(event))
	const status = next_status(statuses.get(issue), event)

	if (run_board_ending_states.is_requeued(event)) statuses.delete(issue)
	else if (status !== undefined && Number.isSafeInteger(issue)) statuses.set(issue, status)
}

// `seed` is what each issue is doing before `events` — a lane's record, so a cut or a stage line whose
// launch rolled off the stream carries the child on.
function fold_events(
	events: ReadonlyArray<RunEvent>,
	seed: ReadonlyMap<number, ItemStatus> = new Map(),
): Map<number, ItemStatus> {
	const statuses = new Map(seed)

	for (const event of events) fold_event(statuses, event)

	return statuses
}

// joshuafolkken/kit#4267: the board redraws every second but rereads the stream every few, and a read
// hands over a new `events` array, so a fold keyed on the array is folded once per read, not per redraw.
type EventsMemo<Value> = WeakMap<ReadonlyArray<RunEvent>, Value>

function remembered<Value>(
	memo: EventsMemo<Value>,
	events: ReadonlyArray<RunEvent>,
	fold: (events: ReadonlyArray<RunEvent>) => Value,
): Value {
	const kept = memo.get(events)

	if (kept !== undefined) return kept

	const value = fold(events)

	memo.set(events, value)

	return value
}

const FOLDED: EventsMemo<ReadonlyMap<number, ItemStatus>> = new WeakMap()
const SPANS: EventsMemo<ReadonlyMap<number | undefined, ReadonlyArray<Span>>> = new WeakMap()

// A child the stream never saw launched keeps no spans, so its row is timed from its lane record.
function with_spans(statuses: Map<number, ItemStatus>, events: ReadonlyArray<RunEvent>): void {
	const spans = remembered(SPANS, events, run_board_lane_time.spans_of)

	for (const [issue, status] of statuses) {
		const issue_spans = spans.get(issue)

		if (issue_spans !== undefined) statuses.set(issue, { ...status, spans: issue_spans })
	}
}

// Every child the run has touched, with what each of this run's open lanes is doing laid over it. An
// earlier run's lane and one with no record are drawn apart (`run-board-earlier.ts`), so what the span
// says of their issues is not this run's. A lane in `idle` has had no child working in it since the
// time it maps to (`lane-spent.ts`); one this run's record ended is stopped too, though no longer open
// (`run-board-lane-stop.ts`).
function statuses_of(
	events: ReadonlyArray<RunEvent>,
	lanes: BoardLanes,
	idle: IdleSince = run_board_idle.NO_IDLE,
): ReadonlyMap<number, ItemStatus> {
	const statuses = new Map(remembered(FOLDED, events, fold_events))
	const apart = [...lanes.earlier.keys(), ...lanes.unknown.map(Number)]

	for (const issue of apart) statuses.delete(issue)

	for (const [issue, status] of lanes.own) statuses.set(issue, status)

	run_board_lane_stop.stop_lanes(statuses, lanes, idle)
	with_spans(statuses, events)

	return statuses
}

// The events naming `issue` from its newest launch on: from `launched_ms` where its lane's record holds
// the launch, else from the stream's newest launch of it — none where the stream holds no launch of it.
function since_launch(
	events: ReadonlyArray<RunEvent>,
	issue: string,
	launched_ms?: number,
): Array<RunEvent> {
	const named = events.filter((event) => run_event_scope.issue_named(event) === issue)

	if (launched_ms !== undefined) return named.filter((event) => moment(event) >= launched_ms)

	const launch = named.findLastIndex((event) => LAUNCH_KINDS.has(event.kind))

	return launch === -1 ? [] : named.slice(launch)
}

// The open listing the plan was read with, and when it was read.
// `open_numbers` is `undefined` when the listing was cut short, so absence from it proves nothing.
interface OpenRead extends ListingRead {
	// The children read closed from GitHub (`run-board-closed.ts`), by number.
	closed: ReadonlyMap<number, ClosedIssue>
	// Each listed issue's label names, by number; an issue the listing did not hold has none to read.
	labels: ReadonlyMap<number, ReadonlyArray<string>>
}

// When the child last launched — what a GitHub read is weighed against.
function launch_ms(status: ItemStatus): number | undefined {
	return status.launched_ms ?? status.started_ms
}

// The listing was read after the child last launched, so what it says about the child is current.
function is_read_after_launch(status: ItemStatus, read: OpenRead): boolean {
	return read.read_ms !== undefined && (launch_ms(status) ?? 0) <= read.read_ms
}

// A running child's labels, read after its launch, settle it (`run-board-lane-stop.ts`).
function labelled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	const stop = is_read_after_launch(status, read)
		? run_board_lane_stop.label_stop(read.labels.get(issue))
		: undefined

	return stop === undefined ? status : run_board_lane_stop.label_settled(status, stop)
}

// A close dated before the launch is an earlier life of the issue, not how this run's child ended.
function is_closed_before_launch(status: ItemStatus, closed: ClosedIssue): boolean {
	const launch = launch_ms(status)

	if (launch === undefined || closed.closed_ms === undefined) return false

	return closed.closed_ms < launch
}

// A child read closed ends when GitHub says it closed — merged, withdrawn as not planned, already
// done, or done.
function closed_as(status: ItemStatus, closed: ClosedIssue): ItemStatus {
	return { ...settled_as(status, run_board_closed.state_of(closed)), ended_ms: closed.closed_ms }
}

function closed_status(
	status: ItemStatus,
	closed: ClosedIssue | undefined,
): ItemStatus | undefined {
	if (closed === undefined || is_closed_before_launch(status, closed)) return undefined

	return closed_as(status, closed)
}

function unsettled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	const from_closed = closed_status(status, read.closed.get(issue))

	return from_closed ?? labelled(issue, status, read)
}

// The closed read is kept for the run, so a waiting child (parked or human) a person reopened since is
// told apart by a listing read after the close holding it again. Once a listing has landed, that — not
// the launch — dates the close, so a closed child never waits in 🙋 decision (joshuafolkken/kit#6535,
// joshuafolkken/kit#6891).
function waiting_settled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	const closed = read.closed.get(issue)
	// `undefined` too for a close dated before this launch — an earlier life's close never settles it.
	const settled_closed = closed_status(status, closed)

	if (closed === undefined || settled_closed === undefined) return status

	return run_board_closed.is_reopened(issue, closed, read) ? status : settled_closed
}

function settled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	if (WAITING_STATES.has(status.state)) return waiting_settled(issue, status, read)

	return UNSETTLED_STATES.has(status.state) ? unsettled(issue, status, read) : status
}

// **The stream stays the source of truth; a closed read only unsticks it.** A child whose merge never
// reached the stream would read as running forever, so a running child GitHub reads closed is drawn
// finished instead — merged, withdrawn or done, and timed. Absence from the open listing alone settles
// nothing: a listing that came back short would draw live children finished (joshuafolkken/kit#4537).
// One the listing holds is drawn as its labels say, so a child that stopped with no parent to record it
// does not read as running. A waiting child is settled again only by a closed read; one a person
// released is dropped after it (`run-board-released.ts`).
function settle_closed(
	statuses: ReadonlyMap<number, ItemStatus>,
	read: OpenRead,
): ReadonlyMap<number, ItemStatus> {
	return new Map(
		[...statuses].map(([issue, status]) => {
			const closed = read.closed.get(issue)
			const outcome =
				closed === undefined || is_closed_before_launch(status, closed) ? undefined : closed.outcome

			return [issue, run_board_settle.with_outcome(settled(issue, status, read), outcome)]
		}),
	)
}

function is_run_stop(event: RunEvent | undefined): boolean {
	return event?.kind === KIND.STOP && run_event_scope.issue_named(event) === undefined
}

function latest_of(event: RunEvent | undefined): LatestEvent | undefined {
	return event === undefined ? undefined : { text: event.text, at_ms: moment(event) }
}

function is_own(event: RunEvent): boolean {
	return event.kind === KIND.SETUP || !run_event_stream.TRACE_KINDS.has(event.kind)
}

// A stream of traces alone has done nothing of its own yet, so its newest event stands in.
function idle_of(events: ReadonlyArray<RunEvent>): number | undefined {
	const own = events.findLast((event) => is_own(event)) ?? events.at(-1)

	return own === undefined ? undefined : moment(own)
}

function stream_activity(events: ReadonlyArray<RunEvent>): RunActivity {
	const last = events.at(-1)
	const position = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return {
		...run_board_setup.read(events),
		last_event_ms: last === undefined ? undefined : moment(last),
		latest: latest_of(position ?? last),
		idle_ms: idle_of(events),
		lane_events: run_board_lane_event.newest_of(events),
		pr_checks: run_board_checks.newest_of(events),
		first_lane_ms: run_event_setup.first_lane_ms(events),
		is_stopped: is_run_stop(position),
	}
}

const ACTIVITIES: EventsMemo<RunActivity> = new WeakMap()

// `is_ended` is a run `run:carry --end` closed: its record says it stopped, whatever its last event
// was.
function activity_of(events: ReadonlyArray<RunEvent>, is_ended = false): RunActivity {
	const activity = remembered(ACTIVITIES, events, stream_activity)

	return is_ended ? { ...activity, is_stopped: true } : activity
}

const run_board_status = {
	WAITING_STATES,
	activity_of,
	fold_events,
	settle_closed,
	since_launch,
	statuses_of,
}

export { run_board_status }
export type { ItemState, ItemStatus, LatestEvent, OpenRead, RunActivity }
