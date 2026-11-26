import { lane_state_record, type LaneState, type PauseOrigin } from './lane-state-record'
import {
	lane_transition_table,
	type LaneGuard,
	type LaneTransitionEvent,
} from './lane-transition-table'

// **Which event of the lifecycle table one lane-state write is, and whether the table lets it
// through** — the check `lane-state.ts` makes under the record's lock before it writes.
//
// A write names its event by its command; a launch is the event that starts a child from the state the
// lane is in (`LAUNCH_EVENTS`), so a lane a dependency wait paused takes no launch until that wait is
// released (`dependency-resume`). **Only the pause-origin guards are evaluated here**; the others are
// joshuafolkken/kit#8777's.

const { ADOPT_COMMAND, DEPENDENCY_WAIT_COMMAND, OPEN_COMMAND, PAUSE_COMMAND } = lane_state_record
// A hand-over keeps the record's `changed_by`, so this command names the event only, never a record.
const HAND_OVER_COMMAND = 'run:hand-over'
// The dependency wait's event and the pause origin it leaves share one name.
const DEPENDENCY_WAIT = 'dependency-wait' as const
const PERSON = 'person' as const
const REVIEW_RESUME = 'review-resume' as const

const COMMAND_EVENTS: ReadonlyMap<string, LaneTransitionEvent> = new Map([
	[OPEN_COMMAND, 'open'],
	[ADOPT_COMMAND, 'adopt'],
	[PAUSE_COMMAND, 'pause'],
	[DEPENDENCY_WAIT_COMMAND, DEPENDENCY_WAIT],
	['lane:resume', 'resume'],
	// Not a launch: the dispatch releasing the lane's dependency wait before it launches.
	['lane:dispatch', 'dependency-resume'],
	['run:hold --human-review-stop', 'human-review'],
	['run:merge', 'merge'],
	['run:hold --halfrun-round', REVIEW_RESUME],
	['run:entry', REVIEW_RESUME],
	['lane:withdraw', 'withdraw'],
	['lane:close', 'close'],
])

// The events that start a child, each from its own states; a lane with no record takes the first.
const LAUNCH_EVENTS: ReadonlyArray<LaneTransitionEvent> = ['launch', 'restart', REVIEW_RESUME]
// The hand-over events, one per state: a hand-over takes the one from the state the lane is in.
const HAND_OVER_EVENTS = lane_transition_table.hand_over_events()

// Who each pausing event pauses the lane for, kept on the record as `paused_by`.
const PAUSED_BY: Partial<Record<LaneTransitionEvent, PauseOrigin>> = {
	pause: PERSON,
	[DEPENDENCY_WAIT]: DEPENDENCY_WAIT,
}

// The pause origin each origin guard asks of the lane's record.
const GUARD_ORIGIN: Partial<Record<LaneGuard, PauseOrigin>> = {
	'paused-by-person': PERSON,
	'paused-by-dependency-wait': DEPENDENCY_WAIT,
}

// One write as the table reads it: the state it asks for, its command, and whether it starts a child.
interface LaneEventRequest {
	state: LaneState
	command: string
	is_launch?: boolean | undefined
}

// Where the lane is: its state and who paused it.
interface LanePosition {
	state: LaneState
	paused_by: PauseOrigin | undefined
}

type LaneVerdict =
	| { kind: 'allowed'; event: LaneTransitionEvent; paused_by: PauseOrigin | undefined }
	| { kind: 'rejected'; reason: string }

function is_from(event: LaneTransitionEvent, from: LaneState | undefined): boolean {
	return from === undefined || lane_transition_table.row_of(event).from.includes(from)
}

/** The event `request` is for a lane at `from` (`undefined`: no record), or `undefined` for none. */
function event_of(
	request: LaneEventRequest,
	from: LaneState | undefined,
): LaneTransitionEvent | undefined {
	if (request.is_launch === true) return LAUNCH_EVENTS.find((event) => is_from(event, from))

	if (request.command === HAND_OVER_COMMAND) {
		return HAND_OVER_EVENTS.find((event) => is_from(event, from))
	}

	return COMMAND_EVENTS.get(request.command)
}

function unmet_guard(event: LaneTransitionEvent, paused_by: PauseOrigin | undefined): string {
	const { guards } = lane_transition_table.row_of(event)
	const unmet = guards.find((guard) => ![undefined, paused_by].includes(GUARD_ORIGIN[guard]))

	return unmet ?? ''
}

// Why `event` cannot move the lane at `position` to `state`, or `''` when it can.
function refusal(event: LaneTransitionEvent, state: LaneState, position?: LanePosition): string {
	const { from, to } = lane_transition_table.row_of(event)

	if (to !== state) return `${event} moves a lane to ${to}, not ${state}`
	if (position === undefined) return ''

	if (!from.includes(position.state)) {
		return `no ${position.state} → ${state} transition by ${event}`
	}

	const guard = unmet_guard(event, position.paused_by)

	return guard === '' ? '' : `${event} needs ${guard}`
}

/**
 * Whether the table lets `request` move a lane at `position`, and by which event; a lane with no record
 * (`position` undefined) takes any event that reaches the state asked for.
 */
function judge(request: LaneEventRequest, position?: LanePosition): LaneVerdict {
	const event = event_of(request, position?.state)

	if (event === undefined) return { kind: 'rejected', reason: `no event for ${request.command}` }

	const reason = refusal(event, request.state, position)

	if (reason !== '') return { kind: 'rejected', reason }

	return { kind: 'allowed', event, paused_by: PAUSED_BY[event] }
}

const lane_state_event = { HAND_OVER_COMMAND, judge }

export { lane_state_event }
export type { LaneEventRequest, LanePosition, LaneVerdict }
