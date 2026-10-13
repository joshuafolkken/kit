import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// What the run's `setup` events (`run-event-setup.ts`) tell `run:board`: the stage the run is at now,
// and which lanes are not children yet. The events carry it all — nothing here infers a stage from
// which records exist.

const KIND = run_event_stream.EVENT_KIND
const { STAGE } = run_event_setup

interface SetupRead {
	// The stage the run itself is working at, in the stage's own words: any stage while the run is
	// starting; from the first launch — or a drain before one — on, a lane opening or a judgment session.
	// `undefined` where the run is at none.
	setup: string | undefined
	// When the run entered that stage — its event's own time, so how long the run has stood there is
	// counted from a record; `undefined` wherever `setup` is.
	setup_ms: number | undefined
}

const NO_SETUP: SetupRead = { setup: undefined, setup_ms: undefined }

// The stages of a hand-back to a session. Only the supervisor's next hand-off ends one, whatever the
// session writes to the stream meanwhile.
const JUDGMENT_STAGES: ReadonlySet<string> = new Set([STAGE.JUDGING, STAGE.SESSION])

function is_setup(event: RunEvent): boolean {
	return event.kind === KIND.SETUP
}

function has_launched(events: ReadonlyArray<RunEvent>): boolean {
	return events.some((event) => event.kind === KIND.CHILD_LAUNCH)
}

// The start is over at the first launch, or at a drain that came before one: a run whose backlog
// emptied with nothing launched is watching, and the hand-off each wake of that watch writes is not a
// run getting ready.
function has_started(events: ReadonlyArray<RunEvent>): boolean {
	return has_launched(events) || events.some((event) => event.kind === KIND.DRAIN)
}

// A lane is opening while the stage naming its issue is newer than the run's newest position: the
// launch it leads to, or whatever the run did instead, ends it. A stage that names no issue — a
// hand-off between two children — prepares nothing a person waits on.
function is_opening(events: ReadonlyArray<RunEvent>, stage: RunEvent): boolean {
	if (run_event_scope.issue_named(stage) === undefined) return false

	const position = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return position === undefined || position.pos < stage.pos
}

// Whether the run is at `stage` now: at any stage while it is starting; after that only at one it is
// itself working through.
function is_standing(events: ReadonlyArray<RunEvent>, stage: RunEvent): boolean {
	if (!has_started(events) || JUDGMENT_STAGES.has(stage.text)) return true

	return is_opening(events, stage)
}

function read(events: ReadonlyArray<RunEvent>): SetupRead {
	const stage = events.findLast((event) => is_setup(event))

	if (stage === undefined || !is_standing(events, stage)) return NO_SETUP

	return { setup: stage.text, setup_ms: Date.parse(stage.at) }
}

function names(event: RunEvent, issue: number): boolean {
	return Number(run_event_scope.issue_named(event)) === issue
}

// A lane the stream saw no launch for is not yet this run's child when the run says it is still
// setting up: it has launched nothing at all, so any lane here is an earlier run's, or it is opening
// this very lane. A stream with no stage on it says neither, and the lane is read as before.
function is_lane_pending(events: ReadonlyArray<RunEvent>, issue: number): boolean {
	const stages = events.filter((event) => is_setup(event))

	if (stages.length === 0) return false

	return !has_launched(events) || stages.some((stage) => names(stage, issue))
}

const run_board_setup = { is_lane_pending, read }

export { run_board_setup }
export type { SetupRead }
