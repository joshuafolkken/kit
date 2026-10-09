import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'

// How far a running lane child has got (joshuafolkken/kit#3444), read from the events that name its
// issue. **Each phase comes from a record a step already writes**: the launch, the `plan` event the
// `fullrun` steps emit before implementing, the `lane-phase` the PreToolUse hook writes at the first
// implementation edit of each session, the ship supervisor's launch, `josh ship`'s own stage trace and
// its stop. Nothing is guessed from the clock, so a child that never reaches a record stays on the
// phase before it rather than being drawn further on.
//
// **A child's phases are a history, not a high-water mark** (joshuafolkken/kit#3526): a ship that stops
// sends the child back to implement, so a furthest phase that never went back held a row on 👀 while it
// was coding again. Each phase is written after the last, and a failed ship's own stages fold into the
// `ship`, `failed` pair, so the retries read as the count of 🔨 and of 🚢💥.

const PHASES = [
	'investigate',
	'plan',
	'implement',
	'ship',
	'review',
	'gate',
	'sync',
	'commit',
	'round_two',
	'followup',
	'report',
	'failed',
] as const

type Phase = (typeof PHASES)[number]

const KIND = run_event_stream.EVENT_KIND
const { PHASE: STAGE_PHASE, STAGE } = run_ship_stage
// A launched child is investigating until a later record says otherwise — no event marks the start.
const LAUNCHED_PHASE: Phase = 'investigate'
const WORD_SEPARATOR = ' '
const STAGE_INDEX = 1
const STAGE_PHASE_INDEX = 2

// `josh ship`'s stages, each its own phase; the preflight is the ship's own start.
const SHIP_PHASES: Readonly<Partial<Record<string, Phase>>> = {
	[STAGE.PREFLIGHT]: 'ship',
	[STAGE.REVIEW]: 'review',
	[STAGE.GATE]: 'gate',
	[STAGE.SYNC]: 'sync',
	[STAGE.COMMIT]: 'commit',
	[STAGE.ROUND_TWO]: 'round_two',
	[STAGE.FOLLOWUP]: 'followup',
	[STAGE.REPORT]: 'report',
}

const LANE_PHASES: Readonly<Partial<Record<string, Phase>>> = { implement: 'implement' }

// The kinds that mark one phase whatever their text says.
const KIND_PHASES: Readonly<Partial<Record<string, Phase>>> = {
	[KIND.PLAN]: 'plan',
	[KIND.SHIP_LAUNCH]: 'ship',
	[KIND.SHIP_STOP]: 'failed',
}

// The word at `index` after the issue — `#<N> <stage> <phase>` carries the stage second.
function word_of(event: RunEvent, index: number): string {
	return event.text.split(WORD_SEPARATOR)[index] ?? ''
}

// A stage marks its phase when it starts; its `done`, and one a resumed ship passed over, mark none.
function ship_phase_of(event: RunEvent): Phase | undefined {
	if (word_of(event, STAGE_PHASE_INDEX) !== STAGE_PHASE.START) return undefined

	return SHIP_PHASES[word_of(event, STAGE_INDEX)]
}

// The phase one event marks, or `undefined` for an event that marks none.
function phase_of(event: RunEvent): Phase | undefined {
	if (event.kind === KIND.LANE_PHASE) return LANE_PHASES[word_of(event, STAGE_INDEX)]
	if (event.kind === KIND.SHIP_STAGE) return ship_phase_of(event)

	return KIND_PHASES[event.kind]
}

// A failed ship keeps only its own start: everything after the newest `ship` folds into `failed`.
function failed_after(track: ReadonlyArray<Phase>): Array<Phase> {
	const ship = track.lastIndexOf('ship')

	return [...track.slice(0, ship + 1), 'failed']
}

// The history after one more phase: the same phase twice in a row — a `ship-launch` and its preflight,
// a second session's first edit — is written once.
function history_after(track: ReadonlyArray<Phase>, next: Phase): Array<Phase> {
	if (next === 'failed') return failed_after(track)

	return track.at(-1) === next ? [...track] : [...track, next]
}

const run_board_phase = { LAUNCHED_PHASE, PHASES, history_after, phase_of }

export { run_board_phase }
export type { Phase }
