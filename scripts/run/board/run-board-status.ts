import {
	has_label_name,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
} from '#scripts/issue/issue-labels'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_checks } from './run-board-checks'
import type { ClosedIssue } from './run-board-closed'
import { run_board_ending_reason } from './run-board-ending-reason'
import { run_board_lane_event, type LaneEvent } from './run-board-lane-event'
import { run_board_phase, type Phase } from './run-board-phase'
import { run_board_setup, type SetupRead } from './run-board-setup'

// What each issue of a run is doing now, read from the run's own event stream and its open lanes.
// Local reads only — no `gh` call — so `run:board` can redraw it every few seconds; the plan these
// statuses are laid over is the slow GitHub half, and so is what a child that left the open listing
// answers when read closed.

type ItemState =
	'running' | 'merged' | 'parked' | 'done' | 'waiting' | 'human' | 'stopped' | 'withdrawn'

interface ItemStatus {
	state: ItemState
	// When the child first launched in this run — a re-dispatch or a restart does not move it, so the
	// row's time is the lane's whole time.
	started_ms?: number | undefined
	// The child's newest launch, present only where it launched again after `started_ms` — what the
	// GitHub read is weighed against.
	launched_ms?: number | undefined
	ended_ms?: number | undefined
	// The seat-free lane label (`lane <N>`) of a running child, when it holds one — the running test reads
	// it; the board does not draw it.
	lane?: string | undefined
	// Every phase the child passed while running, in order (`run-board-phase.ts`) — kept once it settles.
	track?: ReadonlyArray<Phase> | undefined
	// When a running child entered the phase its track ends on — the event that moved it there.
	phase_ms?: number | undefined
	// Why the park or withdraw that ended the child ended it, where its event gives a reason.
	reason?: string | undefined
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
	// The run's last position is a `stop` that names no child — the run itself ended.
	is_stopped: boolean
}

const KIND = run_event_stream.EVENT_KIND
const ENDING_STATES: Readonly<Partial<Record<string, ItemState>>> = {
	[KIND.MERGE]: 'merged',
	[KIND.PARK]: 'parked',
	[KIND.SPLIT]: 'done',
	[KIND.STOP]: 'done',
	[KIND.WITHDRAW]: 'withdrawn',
}
// A cut or a resume says the child is still running, on whatever phase it had reached.
const CONTINUING_KINDS: ReadonlySet<string> = new Set([KIND.CUT, KIND.RESUME])
// A person's restart, and a re-dispatch after an outage, start the child over in a fresh session, so
// its track starts over too; its time does not (`launched`).
const LAUNCH_KINDS: ReadonlySet<string> = new Set([KIND.CHILD_LAUNCH, KIND.RESTART])
// What the GitHub read may still settle: a running child, and one whose lane has no child left in it —
// a child that merged and then died is drawn merged, not stopped.
const UNSETTLED_STATES: ReadonlySet<ItemState> = new Set(['running', 'stopped'])
// A parked child waits on a person, who may close its issue after the park; only a closed read settles
// it again, so one still open stays parked whatever its labels say (joshuafolkken/kit#3958).
const PARKED_STATE: ItemState = 'parked'

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

// The newest launch carried on, where the child launched more than once.
function relaunch_of(status: ItemStatus | undefined): Pick<ItemStatus, 'launched_ms'> {
	const launched_ms = status?.launched_ms

	return launched_ms === undefined ? {} : { launched_ms }
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

// The status a child settles into: its start and the track it had reached, so a settled row still
// draws how it got there.
function settled_as(previous: ItemStatus | undefined, state: ItemState): ItemStatus {
	const track = previous?.track

	return {
		state,
		started_ms: previous?.started_ms,
		...relaunch_of(previous),
		...(track !== undefined && { track }),
	}
}

function ended(previous: ItemStatus | undefined, state: ItemState, event: RunEvent): ItemStatus {
	const reason = run_board_ending_reason.reason_of(event)

	return {
		...settled_as(previous, state),
		ended_ms: moment(event),
		...(reason !== undefined && { reason }),
	}
}

function continued(previous: ItemStatus | undefined): ItemStatus {
	const { started_ms, track, phase_ms } = previous ?? {}

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
	if (LAUNCH_KINDS.has(event.kind)) return launched(previous, event)

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

// A lane is this run's only when its issue is on the run's stream or in `in_run`, so a lane left over
// from an earlier day is not drawn as this run's child. `in_run` leaves out a planned issue whose lane
// an earlier run dispatched (`run-board-github.ts`).
function is_running_lane(
	issue: number,
	status: ItemStatus | undefined,
	events: ReadonlyArray<RunEvent>,
	in_run: ReadonlySet<number>,
): boolean {
	if (status !== undefined) return status.state === 'running'

	return in_run.has(issue) && !run_board_setup.is_lane_pending(events, issue)
}

// A lane no child is working in is stopped whatever the stream last said: a child that died writes no
// ending, so its row would otherwise run — and its phase time grow — for as long as the lane stays.
function lane_status(status: ItemStatus | undefined, lane: string, is_idle: boolean): ItemStatus {
	const held = { lane: `lane ${lane}` }

	return is_idle
		? { ...settled_as(status, 'stopped'), ...held }
		: { state: 'running', ...status, ...held }
}

// Every child the run has touched, with the lane each running child holds. A lane the stream never saw
// launched — a run restored after the stream rolled — still reads as running while its issue is in the
// run's plan (`in_run`); one the run is still setting up for stays waiting until its launch. A lane in
// `idle` has no child working in it (`lane-spent.ts`).
function statuses_of(
	events: ReadonlyArray<RunEvent>,
	lanes: ReadonlyArray<string>,
	in_run: ReadonlySet<number>,
	idle: ReadonlyArray<string> = [],
): ReadonlyMap<number, ItemStatus> {
	const statuses = fold_events(events)

	for (const lane of lanes) {
		const issue = Number(lane)
		const status = statuses.get(issue)

		if (is_running_lane(issue, status, events, in_run)) {
			statuses.set(issue, lane_status(status, lane, idle.includes(lane)))
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
	// Each listed issue's label names, by number; an issue the listing did not hold has none to read.
	labels: ReadonlyMap<number, ReadonlyArray<string>>
}

function is_listed_closed(issue: number, read: OpenRead): boolean {
	return read.open_numbers !== undefined && !read.open_numbers.has(issue)
}

// When the child last launched — what a GitHub read is weighed against.
function launch_ms(status: ItemStatus): number | undefined {
	return status.launched_ms ?? status.started_ms
}

// The listing was read after the child last launched, so what it says about the child is current.
function is_read_after_launch(status: ItemStatus, read: OpenRead): boolean {
	return read.read_ms !== undefined && (launch_ms(status) ?? 0) <= read.read_ms
}

// A child launched before the listing was read and missing from it has closed since.
function is_closed_running(issue: number, status: ItemStatus, read: OpenRead): boolean {
	return is_listed_closed(issue, read) && is_read_after_launch(status, read)
}

// What a running child's labels say it is doing, `undefined` where they agree it is running: the child
// applies `needs-decision` and drops `in-progress` itself when it stops, while the stream's park is
// written by a parent that may no longer be there.
function labelled_state(labels: ReadonlyArray<string> | undefined): ItemState | undefined {
	if (labels === undefined) return undefined
	if (has_label_name(labels, NEEDS_DECISION_LABEL)) return 'human'

	return has_label_name(labels, IN_PROGRESS_LABEL) ? undefined : 'stopped'
}

function labelled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	const state = is_read_after_launch(status, read)
		? labelled_state(read.labels.get(issue))
		: undefined

	return state === undefined ? status : settled_as(status, state)
}

// A close dated before the launch is an earlier life of the issue, not how this run's child ended.
function is_closed_before_launch(status: ItemStatus, closed: ClosedIssue): boolean {
	const launch = launch_ms(status)

	if (launch === undefined || closed.closed_ms === undefined) return false

	return closed.closed_ms < launch
}

function closed_state(closed: ClosedIssue): ItemState {
	if (closed.is_merged) return 'merged'

	return closed.is_not_planned ? 'withdrawn' : 'done'
}

// A child read closed ends when GitHub says it closed — merged, withdrawn as not planned, or done.
function closed_status(
	status: ItemStatus,
	closed: ClosedIssue | undefined,
): ItemStatus | undefined {
	if (closed === undefined || is_closed_before_launch(status, closed)) return undefined

	return { ...settled_as(status, closed_state(closed)), ended_ms: closed.closed_ms }
}

function unsettled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	const from_closed = closed_status(status, read.closed.get(issue))

	if (from_closed !== undefined) return from_closed

	if (is_closed_running(issue, status, read)) return settled_as(status, 'done')

	return labelled(issue, status, read)
}

// The closed read is kept for the run, so a parked child a person reopened since is told apart by the
// listing holding it again.
function parked_settled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	if (read.open_numbers?.has(issue) === true) return status

	return closed_status(status, read.closed.get(issue)) ?? status
}

function settled(issue: number, status: ItemStatus, read: OpenRead): ItemStatus {
	if (status.state === PARKED_STATE) return parked_settled(issue, status, read)

	return UNSETTLED_STATES.has(status.state) ? unsettled(issue, status, read) : status
}

// **The stream stays the source of truth; the listing only unsticks it.** A child whose merge never
// reached the stream would read as running forever, so a running child the plan's open listing no
// longer holds is drawn finished instead — merged and timed once GitHub was read for it, finished
// without a time while that read has not answered. One the listing still holds is drawn as its labels
// say, so a child that stopped with no parent to record it does not read as running. A parked child is
// settled again only by a closed read.
function settle_closed(
	statuses: ReadonlyMap<number, ItemStatus>,
	read: OpenRead,
): ReadonlyMap<number, ItemStatus> {
	return new Map([...statuses].map(([issue, status]) => [issue, settled(issue, status, read)]))
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

// `is_ended` is a run `run:carry --end` closed: its record says it stopped, whatever its last event
// was.
function activity_of(events: ReadonlyArray<RunEvent>, is_ended = false): RunActivity {
	const last = events.at(-1)
	const position = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return {
		...run_board_setup.read(events),
		last_event_ms: last === undefined ? undefined : moment(last),
		latest: latest_of(position ?? last),
		idle_ms: idle_of(events),
		lane_events: run_board_lane_event.newest_of(events),
		pr_checks: run_board_checks.newest_of(events),
		is_stopped: is_ended || is_run_stop(position),
	}
}

const run_board_status = { activity_of, settle_closed, statuses_of }

export { run_board_status }
export type { ItemState, ItemStatus, LatestEvent, OpenRead, RunActivity }
