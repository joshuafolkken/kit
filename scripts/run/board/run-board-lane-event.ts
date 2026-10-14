import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { run_board_phase, type Phase } from './run-board-phase'

// Each running child's newest event of its own — the `lane-phase` the hook writes or a `ship-stage` its
// ship writes — in words, with the phase whose icon its row's track draws. A child inside a long
// `josh ship` makes no call of its own while the ship writes on, so the header's third line reads the
// newer of this and the child's newest operation (joshuafolkken/kit#3767).

interface LaneEvent {
	phase: Phase
	// The event's words after its issue: `implement`, `ship gate`, `ship gate failed`.
	words: string
	at_ms: number
}

const KIND = run_event_stream.EVENT_KIND
const LANE_KINDS: ReadonlySet<string> = new Set([KIND.LANE_PHASE, KIND.SHIP_STAGE])
const WORD_SEPARATOR = ' '
const SHIP = 'ship'

// A ship's stage reads as `ship <stage>` once started and names how it ended after that; a lane's phase
// reads as its own word.
function words_of(event: RunEvent): string {
	const [, stage = '', phase] = event.text.split(WORD_SEPARATOR)

	if (event.kind === KIND.LANE_PHASE) return stage

	const words = [SHIP, stage]

	return (phase === run_ship_stage.PHASE.START ? words : [...words, phase]).join(WORD_SEPARATOR)
}

function lane_event_of(event: RunEvent): LaneEvent | undefined {
	const phase = LANE_KINDS.has(event.kind) ? run_board_phase.stage_phase_of(event) : undefined

	return phase === undefined
		? undefined
		: { phase, words: words_of(event), at_ms: Date.parse(event.at) }
}

// The stream's bound keeps each issue's newest stage start apart from the rest, so the order of the
// lines is not their age.
function is_newer(lane: LaneEvent, held: LaneEvent | undefined): boolean {
	return held === undefined || lane.at_ms >= held.at_ms
}

// The newest lane event of every issue the stream names one for.
function newest_of(events: ReadonlyArray<RunEvent>): ReadonlyMap<number, LaneEvent> {
	const newest = new Map<number, LaneEvent>()

	for (const event of events) {
		const lane = lane_event_of(event)
		const issue = Number(run_event_scope.issue_named(event))

		if (lane !== undefined && is_newer(lane, newest.get(issue))) newest.set(issue, lane)
	}

	return newest
}

const run_board_lane_event = { newest_of }

export { run_board_lane_event }
export type { LaneEvent }
