import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'

// How far a running lane child has got (joshuafolkken/kit#3444), read from the events that name its
// issue. **Each phase comes from a record a step already writes**: the launch, the `plan` event the
// `fullrun` steps emit before implementing, the `lane-phase` the PreToolUse hook writes at the first
// implementation edit, and `josh ship`'s own stage trace. Nothing is guessed from the clock, so a child
// that never reaches a record stays on the phase before it rather than being drawn further on.

const PHASES = [
	'dispatched',
	'investigate',
	'plan',
	'implement',
	'review',
	'gate',
	'commit',
	'followup',
	'merged',
] as const

type Phase = (typeof PHASES)[number]

const KIND = run_event_stream.EVENT_KIND
const { STAGE } = run_ship_stage
// A launched child is investigating until a later record says otherwise — no event marks the start.
const LAUNCHED_PHASE: Phase = 'investigate'
const WORD_SEPARATOR = ' '
const WORD_INDEX = 1

// `josh ship`'s stages, folded onto the board's coarser phases.
const SHIP_PHASES: Readonly<Partial<Record<string, Phase>>> = {
	[STAGE.PREFLIGHT]: 'review',
	[STAGE.REVIEW]: 'review',
	[STAGE.GATE]: 'gate',
	[STAGE.SYNC]: 'commit',
	[STAGE.COMMIT]: 'commit',
	[STAGE.ROUND_TWO]: 'followup',
	[STAGE.FOLLOWUP]: 'followup',
	[STAGE.REPORT]: 'followup',
}

const LANE_PHASES: Readonly<Partial<Record<string, Phase>>> = { implement: 'implement' }

// The word after the issue — `#<N> <stage> <phase>` and `#<N> <phase>` both carry it second.
function word_of(event: RunEvent): string {
	return event.text.split(WORD_SEPARATOR)[WORD_INDEX] ?? ''
}

// The phase one event marks, or `undefined` for an event that marks none.
function phase_of(event: RunEvent): Phase | undefined {
	if (event.kind === KIND.PLAN) return 'plan'
	if (event.kind === KIND.LANE_PHASE) return LANE_PHASES[word_of(event)]

	return event.kind === KIND.SHIP_STAGE ? SHIP_PHASES[word_of(event)] : undefined
}

function index_of(phase: Phase): number {
	return PHASES.indexOf(phase)
}

// **A phase never goes back**: a resumed ship re-emitting `review`, or a re-edit after the gate, keeps the
// furthest phase the child has reached.
function later_of(current: Phase | undefined, next: Phase): Phase {
	if (current === undefined) return next

	return index_of(next) > index_of(current) ? next : current
}

const run_board_phase = { LAUNCHED_PHASE, PHASES, index_of, later_of, phase_of }

export { run_board_phase }
export type { Phase }
