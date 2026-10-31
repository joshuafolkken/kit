import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_status } from './run-board-status'

// The run's own activity, read off the event stream (joshuafolkken/kit#3430).

const KIND = run_event_stream.EVENT_KIND
const T0 = '2026-10-08T09:00:00.000Z'
const T1 = '2026-10-08T09:05:00.000Z'
const T2 = '2026-10-08T09:10:00.000Z'
const LAUNCH_3409 = '#3409 launched'
const MERGE_3409 = '#3409 merged'

function event_at(pos: number, at: string, kind: string, text: string): RunEvent {
	return { pos, at, kind, text }
}

describe('run_board_status.activity_of', () => {
	// joshuafolkken/kit#3689: the run's activity is its newest event and whether it stopped — no wait
	// window, so a waiting run's header is drawn from the same two facts as a working one's.
	it('reads the newest event’s time and nothing about a wait', () => {
		const events = [
			event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409),
			event_at(2, T2, KIND.MERGE, MERGE_3409),
		]

		expect(run_board_status.activity_of(events)).toStrictEqual({
			setup: undefined,
			setup_ms: undefined,
			last_event_ms: Date.parse(T2),
			latest: { text: MERGE_3409, at_ms: Date.parse(T2) },
			idle_ms: Date.parse(T2),
			is_stopped: false,
			lane_events: new Map(),
			pr_checks: new Map(),
			first_lane_ms: undefined,
		})
	})

	it('reads a stop naming no child as the run itself ending, past trailing trace events', () => {
		const events = [
			event_at(1, T0, KIND.STOP, 'backlog drained'),
			event_at(2, T1, KIND.HEARTBEAT, 'still here'),
		]

		expect(run_board_status.activity_of(events).is_stopped).toBe(true)
		expect(run_board_status.activity_of([]).last_event_ms).toBeUndefined()
	})
})

// joshuafolkken/kit#5519: the session's start until its first lane opened, for the header.
describe('run_board_status.activity_of -- time to first lane', () => {
	it('reads the time from the session start to its first lane opening', () => {
		const events = [
			event_at(1, T0, KIND.SETUP, run_event_setup.STAGE.STARTING),
			event_at(2, T1, KIND.SETUP, run_event_setup.opening_lane('3409')),
		]

		expect(run_board_status.activity_of(events).first_lane_ms).toBe(Date.parse(T1) - Date.parse(T0))
	})
})
