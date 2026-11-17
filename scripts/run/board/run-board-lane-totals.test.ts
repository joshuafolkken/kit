import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { describe, expect, it } from 'vitest'
import { run_board_lane_totals } from './run-board-lane-totals'

// joshuafolkken/kit#7770: the lane totals the estimated finish reads — dispatch to merge from the last
// three days, else the whole ledger — and the two medians drawn from them.

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const NOW = Date.parse('2026-11-17T09:00:00.000Z')

function lane(issue: number, dispatched_ms: number, minutes: number): Array<LedgerEntry> {
	const merged_ms = dispatched_ms + minutes * MINUTE
	const base = { issue, lane: `${String(issue)}-lane` }

	return [
		{ ...base, kind: 'dispatch', at: new Date(dispatched_ms).toISOString() },
		{ ...base, kind: 'merge', at: new Date(merged_ms).toISOString() },
	] as Array<LedgerEntry>
}

describe('run_board_lane_totals.totals_of', () => {
	it('reads each recent lane from its dispatch to its merge', () => {
		const entries = [...lane(1, NOW - DAY, 20), ...lane(2, NOW - 10 * DAY, 90)]

		expect(run_board_lane_totals.totals_of(entries, NOW)).toEqual([20 * MINUTE])
	})

	it('falls back to the whole ledger with no lane in the last three days', () => {
		const entries = [...lane(1, NOW - 10 * DAY, 20), ...lane(2, NOW - 9 * DAY, 40)]

		expect(run_board_lane_totals.totals_of(entries, NOW)).toEqual([20 * MINUTE, 40 * MINUTE])
	})

	it('reads none from a ledger with no merge', () => {
		expect(run_board_lane_totals.totals_of([], NOW)).toEqual([])
	})
})

describe('run_board_lane_totals.waiting_ms', () => {
	it('takes the median total', () => {
		expect(run_board_lane_totals.waiting_ms([40, 10, 20])).toBe(20)
	})

	it('takes none with no total', () => {
		expect(run_board_lane_totals.waiting_ms([])).toBeUndefined()
	})
})

describe('run_board_lane_totals.running_left_ms', () => {
	it('takes the median of what the longer lanes took beyond the time so far', () => {
		// 10 and 30 beyond 20; the 10 lane ended sooner.
		expect(run_board_lane_totals.running_left_ms([10, 30, 50], 20)).toBe(20)
	})

	it('takes none where every lane ended sooner', () => {
		expect(run_board_lane_totals.running_left_ms([10, 30], 30)).toBeUndefined()
	})
})
