import { describe, expect, it } from 'vitest'
import { run_board_state, type BoardView } from './run-board-state'

const { FRESH_DATA, FRESH_STATE, FRESH_VIEW, is_due } = run_board_state
const INTERVAL_MS = 1000
const NOW_MS = 5000
// Every `BoardView` field; `satisfies` fails the build when one is renamed or dropped.
const VIEW_KEYS = [
	'baseline_total',
	'spots',
	'typing',
	'sound_snapshot',
	'sound_pending',
	'notice',
] as const satisfies ReadonlyArray<keyof BoardView>

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

	it('is the data state and the view state put together', () => {
		expect(FRESH_STATE).toStrictEqual({ ...FRESH_DATA, ...FRESH_VIEW })
	})

	it('keeps no field in both the data state and the view state', () => {
		const data_keys = new Set(Object.keys(FRESH_DATA))

		expect(Object.keys(FRESH_VIEW).filter((key) => data_keys.has(key))).toStrictEqual([])
	})

	it('keeps every frame field, optional ones included, out of the data state', () => {
		const data_keys = Object.keys(FRESH_DATA)

		expect(VIEW_KEYS.filter((key) => data_keys.includes(key))).toStrictEqual([])
	})
})
