import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_ending_states } from './run-board-ending-states'

const KIND = run_event_stream.EVENT_KIND

describe('run_board_ending_states.is_close', () => {
	it.each([KIND.MERGE, KIND.MEASURED])('reads %s as a close', (kind) => {
		expect(run_board_ending_states.is_close({ kind })).toBe(true)
	})

	it.each([KIND.PARK, KIND.HUMAN_REVIEW, KIND.SPLIT, KIND.STOP, KIND.WITHDRAW, KIND.HEARTBEAT])(
		'does not read %s as a close',
		(kind) => {
			expect(run_board_ending_states.is_close({ kind })).toBe(false)
		},
	)
})

describe('run_board_ending_states.STATES', () => {
	it('draws a merge and a measurement merged, a park parked', () => {
		expect(run_board_ending_states.STATES[KIND.MERGE]).toBe('merged')
		expect(run_board_ending_states.STATES[KIND.MEASURED]).toBe('merged')
		expect(run_board_ending_states.STATES[KIND.PARK]).toBe('parked')
	})
})
