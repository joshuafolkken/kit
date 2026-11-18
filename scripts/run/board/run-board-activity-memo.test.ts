import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_activity } from './run-board-activity'

// joshuafolkken/kit#4267: every one-second redraw folded the whole stream again, though the stream only
// changes when the board rereads it.

const KIND = run_event_stream.EVENT_KIND
const T0 = '2026-10-20T09:00:00.000Z'
const T1 = '2026-10-20T09:05:00.000Z'
const LAUNCH: RunEvent = { pos: 1, at: T0, kind: KIND.CHILD_LAUNCH, text: '#4267 launched' }
const STOP: RunEvent = { pos: 2, at: T1, kind: KIND.STOP, text: 'run stopped' }

describe('run_board_activity.activity_of the same stream twice', () => {
	it('hands back the activity it folded the first time', () => {
		const events = [LAUNCH]

		expect(run_board_activity.activity_of(events)).toBe(run_board_activity.activity_of(events))
	})

	it('draws an ended run stopped without changing the activity it keeps', () => {
		const events = [LAUNCH]

		expect(run_board_activity.activity_of(events, true).is_stopped).toBe(true)
		expect(run_board_activity.activity_of(events).is_stopped).toBe(false)
	})

	it('folds a stream read again afresh', () => {
		const events = [LAUNCH]

		expect(run_board_activity.activity_of(events).is_stopped).toBe(false)
		expect(run_board_activity.activity_of([...events, STOP]).is_stopped).toBe(true)
	})
})
