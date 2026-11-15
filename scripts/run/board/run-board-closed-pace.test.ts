import { describe, expect, it } from 'vitest'
import { run_board_closed_pace } from './run-board-closed-pace'
import { run_board_fixture } from './run-board-fixture'
import { run_board_state } from './run-board-state'

const { LOCAL, START } = run_board_fixture
const { FRESH_STATE } = run_board_state
const { STOPPED_ASK_LIMIT_MS, ended_asked_states } = run_board_closed_pace
const ENDED = { ...LOCAL, ended_ms: START }
const ANSWERED = { ...FRESH_STATE, closed_answered_ms: START }

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
