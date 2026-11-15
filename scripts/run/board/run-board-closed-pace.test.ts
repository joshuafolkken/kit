import { describe, expect, it } from 'vitest'
import { run_board_closed_pace } from './run-board-closed-pace'
import { run_board_fixture } from './run-board-fixture'
import { run_board_state } from './run-board-state'

const { LOCAL, START } = run_board_fixture
const { FRESH_STATE } = run_board_state
const {
	FRESH_END_WINDOW_MS,
	FRESH_RETRY_MS,
	STOPPED_ASK_LIMIT_MS,
	closed_retry_ms,
	ended_asked_states,
} = run_board_closed_pace
const ENDED = { ...LOCAL, ended_ms: START }
const ANSWERED = { ...FRESH_STATE, closed_answered_ms: START }
const CHILD = 7539
const USUAL_MS = 120_000
const LANE_ENDED = {
	...LOCAL,
	lane_states: {
		...LOCAL.lane_states,
		ended: new Map([[CHILD, { ended_ms: START, by: 'lane:close' }]]),
	},
}

describe('run_board_closed_pace.closed_retry_ms', () => {
	it('asks again sooner while an asked child ended its lane within the window', () => {
		expect(closed_retry_ms(LANE_ENDED, [CHILD], START + FRESH_END_WINDOW_MS, USUAL_MS)).toBe(
			FRESH_RETRY_MS,
		)
	})

	it('keeps the usual interval past the window', () => {
		expect(closed_retry_ms(LANE_ENDED, [CHILD], START + FRESH_END_WINDOW_MS + 1, USUAL_MS)).toBe(
			USUAL_MS,
		)
	})

	it('keeps the usual interval when no asked child ended its lane', () => {
		expect(closed_retry_ms(LANE_ENDED, [CHILD + 1], START, USUAL_MS)).toBe(USUAL_MS)
		expect(closed_retry_ms(LOCAL, [CHILD], START, USUAL_MS)).toBe(USUAL_MS)
	})
})

describe('run_board_closed_pace.ended_asked_states', () => {
	it('asks as a going run does while the run is going', () => {
		expect(ended_asked_states(ANSWERED, LOCAL, START)).toBeUndefined()
	})

	it('asks as a going run does until an ask after the end has answered whole', () => {
		const earlier = { ...FRESH_STATE, closed_answered_ms: START - 1 }

		expect(ended_asked_states(earlier, ENDED, START)).toBeUndefined()
		expect(ended_asked_states(FRESH_STATE, ENDED, START)).toBeUndefined()
	})

	it('asks about stopped and waiting children within the limit', () => {
		const states = ended_asked_states(ANSWERED, ENDED, START + STOPPED_ASK_LIMIT_MS)

		expect(states?.has('stopped')).toBe(true)
		expect(states?.has('parked')).toBe(true)
		expect(states?.has('human')).toBe(true)
		expect(states?.has('running')).toBe(false)
	})

	it('asks only about waiting children past the limit', () => {
		const states = ended_asked_states(ANSWERED, ENDED, START + STOPPED_ASK_LIMIT_MS + 1)

		expect(states?.has('stopped')).toBe(false)
		expect(states?.has('parked')).toBe(true)
		expect(states?.has('human')).toBe(true)
	})
})
