import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'

// How far a running lane child has got, read from the events that name its issue. **Each phase comes
// from a record a step already writes**: the launch, the `plan` event `run-event-plan.ts` writes, the
// `lane-phase` the PreToolUse hook writes at the first implementation edit of each session, the ship
// supervisor's launch, `josh ship`'s own stage trace and its stop. Nothing is guessed from the clock,
// so a child that never reaches a record stays on the phase before it rather than being drawn further
// on.
//
// **A child's phases are a history, not a high-water mark**: a ship that stops sends the child back to
// implement, so a furthest phase that never went back would hold a row on 👀 while it codes again.
// Each phase is written after the last, and a failed ship's own stages fold into the `ship`, `failed`
// pair, so the retries read as the count of 🔨 and of 🚢💥. A stage line that lists its attempt
// redraws that attempt whole (`replayed`).

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
const { STAGE } = run_ship_stage
// A launched child is investigating until a later record says otherwise — no event marks the start.
const LAUNCHED_PHASE: Phase = 'investigate'
const WORD_SEPARATOR = ' '
const STAGE_INDEX = 1

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

// The word after the issue — `#<N> <stage> <phase>` carries the stage second.
function stage_word_of(event: RunEvent): string {
	return event.text.split(WORD_SEPARATOR)[STAGE_INDEX] ?? ''
}

// A stage marks its phase when it starts; its `done`, and one a resumed ship passed over, mark none.
function ship_phase_of(event: RunEvent): Phase | undefined {
	if (!run_event_stream.is_stage_start(event)) return undefined

	return SHIP_PHASES[stage_word_of(event)]
}

// The phase one event marks, or `undefined` for an event that marks none.
function phase_of(event: RunEvent): Phase | undefined {
	if (event.kind === KIND.LANE_PHASE) return LANE_PHASES[stage_word_of(event)]
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

const ATTEMPT_PHASES: ReadonlySet<Phase | undefined> = new Set(Object.values(SHIP_PHASES))

// The phases a `ship-stage` line says its attempt has started (`run-ship-stage.ts` → `event_text`), in
// the order they ran and led by the ship's own start, which a resumed ship's passed-over preflight does
// not list. `undefined` for a line that carries none — an older three-word line is read one phase at a
// time.
function attempt_of(event: RunEvent): ReadonlyArray<Phase> | undefined {
	const started = event.kind === KIND.SHIP_STAGE ? run_ship_stage.started_of(event.text) : undefined

	if (started === undefined) return undefined

	return [...new Set<Phase>(['ship', ...started.flatMap((stage) => SHIP_PHASES[stage] ?? [])])]
}

// Where the current ship attempt starts on a track: the first `ship` of the stages that end it, else the
// end — a failed or re-implemented attempt before it is history, never redrawn. A supervisor restarted
// with no stop between adds a second `ship` inside the same attempt, which the line redraws whole.
function attempt_start(track: ReadonlyArray<Phase>): number {
	const tail = track.findLastIndex((phase) => !ATTEMPT_PHASES.has(phase)) + 1
	const ship = track.indexOf('ship', tail)

	return ship === -1 ? track.length : ship
}

// **The newest line restores what the bound dropped**: on a stream full of
// positions only each issue's newest stage line survives, so the current attempt is redrawn from it, in
// the order the line lists. A line that misses a phase the track holds — a restarted supervisor's, which
// lists none of the stages it passed over — is added after them rather than replacing them.
function replayed(track: ReadonlyArray<Phase>, attempt: ReadonlyArray<Phase>): Array<Phase> {
	const start = attempt_start(track)
	const current = track.slice(start)
	const is_covered = current.every((phase) => attempt.includes(phase))

	return [...track.slice(0, start), ...(is_covered ? attempt : new Set([...current, ...attempt]))]
}

const run_board_phase = { LAUNCHED_PHASE, PHASES, attempt_of, history_after, phase_of, replayed }

export { run_board_phase }
export type { Phase }
