import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { describe, expect, it } from 'vitest'
import { run_board_lane_event } from './run-board-lane-event'

// joshuafolkken/kit#3767: each child's newest `lane-phase` or `ship-stage`, in words and with its row's
// phase, for the header's third line to set against the child's newest operation.

const KIND = run_event_stream.EVENT_KIND
const { PHASE, STAGE } = run_ship_stage
const { newest_of } = run_board_lane_event
const SECOND = 1000
const START = Date.parse('2026-10-14T09:00:00.000Z')

function event_of(kind: string, text: string, second: number): RunEvent {
	return { pos: second, at: new Date(START + second * SECOND).toISOString(), kind, text }
}

function ship(issue: string, stage: string, phase: string, second: number): RunEvent {
	return event_of(KIND.SHIP_STAGE, `#${issue} ${stage} ${phase}`, second)
}

describe('run_board_lane_event.newest_of', () => {
	it('reads a started stage as `ship <stage>`, under its phase', () => {
		const events = [
			event_of(
				KIND.SHIP_STAGE,
				run_ship_stage.event_text('7', STAGE.GATE, PHASE.START, [STAGE.REVIEW, STAGE.GATE]),
				1,
			),
		]

		expect(newest_of(events).get(7)).toEqual({
			phase: 'gate',
			words: 'ship gate',
			at_ms: START + SECOND,
		})
	})

	it('names how a stage ended after it, a failed one under the ship’s failure', () => {
		const lanes = newest_of([
			ship('7', STAGE.REVIEW, PHASE.DONE, 1),
			ship('8', STAGE.GATE, PHASE.FAILED, 2),
		])

		expect(lanes.get(7)).toMatchObject({ phase: 'review', words: 'ship review done' })
		expect(lanes.get(8)).toMatchObject({ phase: 'failed', words: 'ship gate failed' })
	})

	it('reads the hook’s `lane-phase` in its own word', () => {
		const lanes = newest_of([event_of(KIND.LANE_PHASE, '#7 implement', 1)])

		expect(lanes.get(7)).toMatchObject({ phase: 'implement', words: 'implement' })
	})
})

describe('run_board_lane_event.newest_of — which events it keeps', () => {
	it('keeps each issue’s newest, whatever order the lines stand in', () => {
		const events = [ship('7', STAGE.GATE, PHASE.START, 3), ship('7', STAGE.REVIEW, PHASE.START, 2)]

		expect(newest_of(events).get(7)?.words).toBe('ship gate')
	})

	it('reads no other kind of event, and none that names no phase', () => {
		const events = [
			event_of(KIND.MERGE, '#7 merged', 1),
			event_of(KIND.LANE_PHASE, '#8 reticulating', 2),
			event_of(KIND.SHIP_STAGE, 'gate start', 3),
		]

		expect(newest_of(events).size).toBe(0)
	})
})
