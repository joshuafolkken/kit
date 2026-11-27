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

// A past lane's declared size, as the merge's `size` record carries it.
function sized(issue: number, lines: number): LedgerEntry {
	const at = new Date(NOW - DAY).toISOString()

	return { kind: 'size', at, issue, declared: { files: 1, lines } } as unknown as LedgerEntry
}

// A running or waiting row's declared size, as `lane:plan` writes it.
function declared(issue: number, lines: number, at_ms = NOW - MINUTE): LedgerEntry {
	return { kind: 'declared', at: new Date(at_ms).toISOString(), issue, files: 1, lines }
}

// `count` merged lanes of `minutes` each, numbered from `first`, each declaring `lines`.
function band(first: number, count: number, minutes: number, lines: number): Array<LedgerEntry> {
	return Array.from({ length: count }, (_, index) => [
		...lane(first + index, NOW - DAY, minutes),
		sized(first + index, lines),
	]).flat()
}

const LARGE_LINES = 310
const SMALL_LINES = 20
const MEDIUM_LINES = 70
const LARGE = band(100, run_board_lane_totals.MIN_BAND_LANES, 60, LARGE_LINES)
const SMALL = band(200, run_board_lane_totals.MIN_BAND_LANES, 20, SMALL_LINES)

// The totals the row for `issue` reads from `entries`.
function row_totals(entries: Array<LedgerEntry>, issue: number): ReadonlyArray<number> {
	const totals = run_board_lane_totals.totals_of(entries, NOW)
	const bands = run_board_lane_totals.bands_of(entries, NOW)

	return run_board_lane_totals.totals_for(totals, bands, issue)
}

describe('run_board_lane_totals.totals_for — the declared size’s band', () => {
	it('narrows a declared row to its band’s lanes', () => {
		const entries = [...LARGE, ...SMALL, declared(1, LARGE_LINES), declared(2, SMALL_LINES)]

		expect(run_board_lane_totals.waiting_ms(row_totals(entries, 1))).toBe(60 * MINUTE)
		expect(run_board_lane_totals.waiting_ms(row_totals(entries, 2))).toBe(20 * MINUTE)
	})

	it('reads the whole totals where the band has fewer lanes than the floor', () => {
		const entries = [...LARGE.slice(3), ...SMALL, declared(1, LARGE_LINES)]

		expect(row_totals(entries, 1)).toEqual(run_board_lane_totals.totals_of(entries, NOW))
	})

	it('reads the whole totals for a medium row even with a full medium band', () => {
		const medium = band(300, run_board_lane_totals.MIN_BAND_LANES, 40, MEDIUM_LINES)
		const entries = [...LARGE, ...SMALL, ...medium, declared(1, MEDIUM_LINES)]

		expect(row_totals(entries, 1)).toEqual(run_board_lane_totals.totals_of(entries, NOW))
	})

	it('reads the whole totals for a row the ledger carries no declared size for', () => {
		const entries = [...LARGE, ...SMALL]

		expect(row_totals(entries, 1)).toHaveLength(2 * run_board_lane_totals.MIN_BAND_LANES)
	})

	it('reads the latest declared size of a re-planned row', () => {
		const replanned = [declared(1, SMALL_LINES, NOW - 2 * MINUTE), declared(1, LARGE_LINES)]

		const totals = row_totals([...LARGE, ...SMALL, ...replanned], 1)

		expect(run_board_lane_totals.waiting_ms(totals)).toBe(60 * MINUTE)
	})

	it('reads the whole totals with no bands read', () => {
		expect(run_board_lane_totals.totals_for([MINUTE], undefined, 1)).toEqual([MINUTE])
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
