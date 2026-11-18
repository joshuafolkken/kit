import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_activity } from './run-board-activity'

// joshuafolkken/kit#7895: the run's connection turns read off its stream — when an open outage began, and
// never as the run's own newest event.

const KIND = run_event_stream.EVENT_KIND
const START = Date.parse('2026-11-18T00:00:00.000Z')
const MINUTE_MS = 60_000

function at(minute: number): number {
	return START + minute * MINUTE_MS
}

function event_of(kind: string, minute: number): RunEvent {
	return { pos: minute, at: new Date(at(minute)).toISOString(), kind, text: kind }
}

const LAUNCH = event_of(KIND.CHILD_LAUNCH, 0)

describe('run_board_activity.activity_of -- offline', () => {
	it('reads the open outage: when it began and when it was last seen', () => {
		const events = [LAUNCH, event_of(KIND.OFFLINE, 1), event_of(KIND.OFFLINE_TICK, 2)]

		expect(run_board_activity.activity_of(events).outage).toStrictEqual({
			from_ms: at(1),
			down_ms: at(2),
		})
	})

	it('reads no outage after the recovery, nor where no turn was written', () => {
		const recovered = [LAUNCH, event_of(KIND.OFFLINE, 1), event_of(KIND.ONLINE, 2)]

		expect(run_board_activity.activity_of(recovered).outage).toBeUndefined()
		expect(run_board_activity.activity_of([LAUNCH]).outage).toBeUndefined()
	})

	it('leaves the connection turns out of the newest event', () => {
		const turns = [
			event_of(KIND.OFFLINE, 1),
			event_of(KIND.OFFLINE_TICK, 2),
			event_of(KIND.ONLINE, 3),
		]

		expect(run_board_activity.activity_of([LAUNCH, ...turns]).last_event_ms).toBe(at(0))
	})
})
