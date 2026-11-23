import { lane_state_record, type LaneState } from './lane-state-record'

// **The lane lifecycle as one table: state × event → next state, with the guards the event needs.**
// Every operation that changes a lane's record is one of these events; the allowed-transition table
// `lane-state.ts` checks each write against is derived from it (`allowed_transitions`), never kept
// beside it. Which operations are events here and which live on another path (a label, a marker file,
// the hold stamp): `docs/maintainers/lane-lifecycle.md`.
//
// **Guards are named, not evaluated, here** — the evaluation is joshuafolkken/kit#8777's.

const { HUMAN_REVIEW, LANE_STATES } = lane_state_record

const GUARD = {
	// The lane has no record yet — an adopt never overwrites one (`lane-state.ts` → `record_adopted`).
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
} as const

type LaneGuard = (typeof GUARD)[keyof typeof GUARD]

const LANE_GUARDS: ReadonlyArray<LaneGuard> = Object.values(GUARD)

interface LaneEventRow {
	from: ReadonlyArray<LaneState>
	to: LaneState
	guards: ReadonlyArray<LaneGuard>
}

// `from: []` is an event only a lane with no record takes; a record-less lane moves to any state.
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
	'hand-over-open': { from: ['open'], to: 'open', guards: [GUARD.OWNER_ENDED] },
	'hand-over-running': { from: ['running'], to: 'running', guards: [GUARD.OWNER_ENDED] },
	'hand-over-review': { from: [HUMAN_REVIEW], to: HUMAN_REVIEW, guards: [GUARD.OWNER_ENDED] },
	'human-review': { from: ['open', 'running', HUMAN_REVIEW], to: HUMAN_REVIEW, guards: [] },
	merge: { from: ['open', 'running'], to: HUMAN_REVIEW, guards: [GUARD.NO_STOP_MARKER] },
	'review-resume': { from: [HUMAN_REVIEW], to: 'running', guards: [GUARD.WORK_TREE] },
	withdraw: { from: ['open', 'running', 'paused', HUMAN_REVIEW], to: 'ended', guards: [] },
	close: { from: ['open', 'running', 'paused', HUMAN_REVIEW, 'ended'], to: 'ended', guards: [] },
} as const satisfies Record<string, LaneEventRow>

type LaneEvent = keyof typeof LANE_EVENTS

const LANE_EVENT_NAMES = Object.keys(LANE_EVENTS) as ReadonlyArray<LaneEvent>

/** The row of `event`. */
function row_of(event: LaneEvent): LaneEventRow {
	return LANE_EVENTS[event]
}

/** The state `event` moves a lane in `from` to, or `undefined` when the table rejects it there. */
function next_state(from: LaneState, event: LaneEvent): LaneState | undefined {
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
	LANE_EVENT_NAMES,
	LANE_GUARDS,
	allowed_transitions,
	next_state,
	row_of,
}

export { lane_transition_table }
export type { LaneEvent, LaneEventRow, LaneGuard }
