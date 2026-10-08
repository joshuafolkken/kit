import { describe, expect, it } from 'vitest'
import { run_board_state } from './run-board-state'

const { FRESH_STATE, is_due } = run_board_state
const INTERVAL_MS = 1000
const NOW_MS = 5000

describe('run_board_state.is_due', () => {
	it('is due when nothing was taken yet', () => {
		expect(is_due(undefined, INTERVAL_MS, NOW_MS)).toBe(true)
	})

	it('is due once the interval has passed', () => {
		expect(is_due(NOW_MS - INTERVAL_MS, INTERVAL_MS, NOW_MS)).toBe(true)
	})

	it('is not due inside the interval', () => {
		expect(is_due(NOW_MS - INTERVAL_MS + 1, INTERVAL_MS, NOW_MS)).toBe(false)
	})
})

describe('run_board_state.FRESH_STATE', () => {
	it('starts with no GitHub read in flight', () => {
		expect(FRESH_STATE.plan_fetch).toBeUndefined()
		expect(FRESH_STATE.closed_fetch).toBeUndefined()
	})
})
