import { describe, expect, it } from 'vitest'
import { lane_held_stats } from './lane-held-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#3995: one ledger period reduces to a row per hold reason — how long a free lane
// stayed empty until the next hold or dispatch, so idle capacity is split by its cause.

const NOW = Date.parse('2026-10-17T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_MINUTE = 60_000
const BLOCKED = 'offer:wait:blocked'
const HAND_BACK = 'hand-back:merge'
const MEMORY = 'memory'
const LONG_AGO_MINUTES = 300

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

function held(reason: string, minutes_before: number): LedgerEntry {
	return { kind: 'held', at: minutes_before_now(minutes_before), reason }
}

function dispatch(minutes_before: number): LedgerEntry {
	return { kind: 'dispatch', at: minutes_before_now(minutes_before), issue: 1 }
}

function row_of(entries: ReadonlyArray<LedgerEntry>, reason: string): string | undefined {
	return lane_held_stats
		.table(entries, WINDOW)
		.split('\n')
		.find((line) => line.startsWith(`| ${reason} |`))
}

describe('lane_held_stats.table', () => {
	it('tiles consecutive holds up to the dispatch that ended them', () => {
		const entries = [held(BLOCKED, 30), held(BLOCKED, 29), held(BLOCKED, 28), dispatch(25)]

		expect(row_of(entries, BLOCKED)).toBe(`| ${BLOCKED} | 5.0 | 1.0 | 3.0 | 3 | 0 |`)
	})

	it('splits the idle time by reason, the longest total first', () => {
		const entries = [held(BLOCKED, 40), held(HAND_BACK, 39), dispatch(16)]
		const lines = lane_held_stats.table(entries, WINDOW).split('\n')

		expect(lines[2]).toBe(`| ${HAND_BACK} | 23.0 | 23.0 | 23.0 | 1 | 0 |`)
		expect(lines[3]).toBe(`| ${BLOCKED} | 1.0 | 1.0 | 1.0 | 1 | 0 |`)
	})

	it('ends a hold at the earliest later entry, whatever order the ledger holds them in', () => {
		const entries = [dispatch(5), held(BLOCKED, 30), dispatch(20), held(HAND_BACK, 26)]

		expect(row_of(entries, BLOCKED)).toBe(`| ${BLOCKED} | 4.0 | 4.0 | 4.0 | 1 | 0 |`)
	})

	it('ends a hold at the release a full pool wrote, counted as no hold itself', () => {
		const released: LedgerEntry = { kind: 'released', at: minutes_before_now(27) }
		const entries = [held(BLOCKED, 30), released, dispatch(5)]

		expect(row_of(entries, BLOCKED)).toBe(`| ${BLOCKED} | 3.0 | 3.0 | 3.0 | 1 | 0 |`)
	})

	it('counts a hold nothing followed as not ended', () => {
		expect(row_of([held(BLOCKED, 10)], BLOCKED)).toBe(
			`| ${BLOCKED} | not measured | not measured | not measured | 1 | 1 |`,
		)
	})

	it('caps a hold no driver ended at the hour', () => {
		const entries = [held(HAND_BACK, LONG_AGO_MINUTES), dispatch(1)]

		expect(row_of(entries, HAND_BACK)).toBe(`| ${HAND_BACK} | 60.0 | 60.0 | 60.0 | 1 | 0 |`)
	})

	it('prints a zero row for a period without a hold', () => {
		expect(row_of([dispatch(1)], 'none')).toBe(
			'| none | not measured | not measured | not measured | 0 | 0 |',
		)
	})
})

// joshuafolkken/kit#4084: a run held for memory is its own row.
describe('lane_held_stats.table — a memory hold', () => {
	it('rows a memory hold apart from the offer’s', () => {
		const entries = [held(MEMORY, 30), held(BLOCKED, 20), dispatch(10)]

		expect(row_of(entries, MEMORY)).toBe(`| ${MEMORY} | 10.0 | 10.0 | 10.0 | 1 | 0 |`)
	})
})

// joshuafolkken/kit#4084: `run:board` reads the driver's memory hold off the hold still open.
describe('lane_held_stats.open_reason', () => {
	it('reads the reason of the last hold nothing ended', () => {
		expect(lane_held_stats.open_reason([held(BLOCKED, 20), held(MEMORY, 10)])).toBe(MEMORY)
	})

	it('reads no reason once a dispatch or a release ended the last hold', () => {
		const released: LedgerEntry = { kind: 'released', at: minutes_before_now(5) }

		expect(lane_held_stats.open_reason([held(MEMORY, 10), dispatch(5)])).toBeUndefined()
		expect(lane_held_stats.open_reason([held(MEMORY, 10), released])).toBeUndefined()
	})

	it('reads no reason from a ledger without a hold', () => {
		expect(lane_held_stats.open_reason([])).toBeUndefined()
	})
})
