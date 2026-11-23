import { lane_state_record, type LaneState } from './lane-state-record'

// **The lane lifecycle as one table: state × event → next state, with the guards the event needs.**
// Every operation that changes a lane's record is one of these events; the allowed-transition table
// `lane-state.ts` checks each write against is derived from it (`allowed_transitions`), never kept
// beside it. Which operations are events here and which live on another path (a label, a marker file,
// the hold stamp): `docs/maintainers/lane-lifecycle.md`.
//
// **Guards are named, not evaluated, here** — `lane-transition-guards.ts` evaluates the ones read
// outside the lane record (the work tree, the checkout's hold); the rest are read by the event's writer.

const { HUMAN_REVIEW, LANE_STATES } = lane_state_record

const GUARD = {
	// The lane has no record yet — an adopt never overwrites one (`lane-state.ts` → `record_owner`).
	NO_RECORD: 'no-record',
	// The lane's branch and work tree still exist, so a child can run in them.
	WORK_TREE: 'work-tree-present',
	// A person paused the lane (`lane:pause`), not a dependency wait.
	BY_PERSON: 'paused-by-person',
	// A dependency wait paused the lane (`changed_by` is `lane:dependency-wait`).
	BY_DEPENDENCY: 'paused-by-dependency-wait',
	// The run that owns the lane has ended, so another run may take it over.
	OWNER_ENDED: 'owner-run-ended',
	// The child exited before it stamped its human-review stop marker.
	NO_STOP_MARKER: 'stop-marker-missing',
	// No other run's hold stamp owns the primary checkout a merge switches and pulls. It gates the
	// merge's `main:sync` (`run-merge-sync.ts`), not the human-review record write on this row.
	CHECKOUT_FREE: 'checkout-not-held-by-another-run',
} as const

type LaneGuard = (typeof GUARD)[keyof typeof GUARD]

const LANE_GUARDS: ReadonlyArray<LaneGuard> = Object.values(GUARD)

// `is_owner_only`: the event moves only the lane's owner run, keeping its state, who paused it and its
// last change — a hand-over of the lane to a later run (joshuafolkken/kit#8472, joshuafolkken/kit#8455).
interface LaneTransitionEventRow {
	from: ReadonlyArray<LaneState>
	to: LaneState
	guards: ReadonlyArray<LaneGuard>
	is_owner_only?: boolean
}

/** A hand-over of a lane in `state`: once its owner run has ended, only the owner moves. */
function owner_row(state: LaneState): LaneTransitionEventRow {
	return { from: [state], to: state, guards: [GUARD.OWNER_ENDED], is_owner_only: true }
}

// `from: []` is an event only a lane with no record takes; a record-less lane moves to any state.
// An adopt writes a fresh `open` record; a hand-over keeps the record and moves only its owner run.
const LANE_EVENTS = {
	open: { from: ['open', 'ended'], to: 'open', guards: [] },
	adopt: { from: [], to: 'open', guards: [GUARD.NO_RECORD] },
	launch: { from: ['open'], to: 'running', guards: [GUARD.WORK_TREE] },
	restart: { from: ['running'], to: 'running', guards: [GUARD.WORK_TREE] },
	pause: { from: ['open', 'running', 'paused'], to: 'paused', guards: [] },
	'dependency-wait': { from: ['open', 'running'], to: 'paused', guards: [] },
	resume: { from: ['paused'], to: 'running', guards: [GUARD.BY_PERSON, GUARD.WORK_TREE] },
	'dependency-resume': {
		from: ['paused'],
		to: 'running',
		guards: [GUARD.BY_DEPENDENCY, GUARD.WORK_TREE],
	},
	'hand-over-open': owner_row('open'),
	'hand-over-running': owner_row('running'),
	'hand-over-paused': owner_row('paused'),
	'hand-over-review': owner_row(HUMAN_REVIEW),
	'human-review': { from: ['open', 'running', HUMAN_REVIEW], to: HUMAN_REVIEW, guards: [] },
	merge: {
		from: ['open', 'running'],
		to: HUMAN_REVIEW,
		guards: [GUARD.NO_STOP_MARKER, GUARD.CHECKOUT_FREE],
	},
	'review-resume': { from: [HUMAN_REVIEW], to: 'running', guards: [GUARD.WORK_TREE] },
	withdraw: { from: ['open', 'running', 'paused', HUMAN_REVIEW], to: 'ended', guards: [] },
	close: { from: ['open', 'running', 'paused', HUMAN_REVIEW, 'ended'], to: 'ended', guards: [] },
} as const satisfies Record<string, LaneTransitionEventRow>

type LaneTransitionEvent = keyof typeof LANE_EVENTS

const LANE_EVENT_NAMES = Object.keys(LANE_EVENTS) as ReadonlyArray<LaneTransitionEvent>

/** The row of `event`. */
function row_of(event: LaneTransitionEvent): LaneTransitionEventRow {
	return LANE_EVENTS[event]
}

/** The hand-over events, one per state a lane is handed over in. */
function hand_over_events(): ReadonlyArray<LaneTransitionEvent> {
	return LANE_EVENT_NAMES.filter((event) => row_of(event).is_owner_only === true)
}

/** The state `event` moves a lane in `from` to, or `undefined` when the table rejects it there. */
function next_state(from: LaneState, event: LaneTransitionEvent): LaneState | undefined {
	const row = row_of(event)

	return row.from.includes(from) ? row.to : undefined
}

/** The states a lane in `from` moves to by any event, each once. */
function targets_of(from: LaneState): ReadonlyArray<LaneState> {
	const targets = LANE_EVENT_NAMES.map((event) => next_state(from, event))

	return [...new Set(targets.filter((state): state is LaneState => state !== undefined))]
}

/** The allowed-transition table every record write is checked against, derived from the events. */
function allowed_transitions(): Record<LaneState, ReadonlyArray<LaneState>> {
	const entries = LANE_STATES.map((state): [LaneState, ReadonlyArray<LaneState>] => [
		state,
		targets_of(state),
	])

	return Object.fromEntries(entries) as Record<LaneState, ReadonlyArray<LaneState>>
}

const lane_transition_table = {
	GUARD,
	LANE_EVENT_NAMES,
	LANE_GUARDS,
	allowed_transitions,
	hand_over_events,
	next_state,
	row_of,
}

export { lane_transition_table }
export type { LaneTransitionEvent, LaneTransitionEventRow, LaneGuard }
