import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_limit_table } from './lane-limit-table'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#8762: the period split by the lane limit each entry was written under, and the
// limit with the most merges per active hour picked from it.

const NOW = Date.parse('2026-11-20T12:00:00.000Z')
const MS_PER_HOUR = 3_600_000
const WINDOW = lane_stats.window_of(1, NOW)
const ISSUE = 7
const LOW = 4
const HIGH = 6
const SHORT = 8

function at(hours_ago: number): string {
	return new Date(NOW - hours_ago * MS_PER_HOUR).toISOString()
}

function limit(hours_ago: number, value: number): LedgerEntry {
	return { kind: 'limit', at: at(hours_ago), limit: value }
}

// One working sample an hour from `from` down to `to`, both included.
function samples(from: number, to: number): Array<LedgerEntry> {
	return Array.from({ length: from - to + 1 }, (_, index) => ({
		kind: 'load' as const,
		at: at(from - index),
		load: 4,
		lanes: 2,
	}))
}

function merges(count: number, from: number, to: number): Array<LedgerEntry> {
	const step = (from - to) / count

	return Array.from({ length: count }, (_, index) => ({
		kind: 'merge' as const,
		at: at(from - step * (index + 1)),
		issue: ISSUE,
	}))
}

// Nine active hours at each limit: 18 merges under four lanes, 9 under six.
const LEDGER: ReadonlyArray<LedgerEntry> = [
	limit(20, LOW),
	...samples(20, 11),
	...merges(18, 20, 11),
	limit(10, HIGH),
	...samples(10, 1),
	...merges(9, 10, 1),
]

describe('lane_limit_table.limit_at', () => {
	const timeline = lane_limit_table.timeline_of([limit(10, HIGH), limit(20, LOW)])

	function limit_hours_ago(hours_ago: number): number | undefined {
		return lane_limit_table.limit_at(timeline, NOW - hours_ago * MS_PER_HOUR)
	}

	it('reads no limit before the first change', () => {
		expect(limit_hours_ago(21)).toBeUndefined()
	})

	it('reads the change written at the instant itself', () => {
		expect(limit_hours_ago(10)).toBe(HIGH)
	})

	it('reads the last change before the instant, whatever order the lines came in', () => {
		expect(limit_hours_ago(15)).toBe(LOW)
		expect(limit_hours_ago(0)).toBe(HIGH)
	})
})

describe('lane_limit_table.slices_of', () => {
	const dispatch: LedgerEntry = { kind: 'dispatch', at: at(12), issue: ISSUE }
	const slices = lane_limit_table.slices_of([...LEDGER, dispatch], WINDOW)

	it('gives one slice per limit, lowest first', () => {
		expect(slices.map((slice) => slice.limit)).toEqual([LOW, HIGH])
	})

	it('puts each merge under the limit it was written under', () => {
		const counts = slices.map((slice) => slice.entries.filter((e) => e.kind === 'merge').length)

		expect(counts).toEqual([18, 9])
	})

	it('keeps a dispatch in every slice, since a lane may start under another limit', () => {
		expect(slices.every((slice) => slice.entries.includes(dispatch))).toBe(true)
	})
})

describe('lane_limit_table.best_limit', () => {
	it('picks the limit with the most merges per active hour', () => {
		expect(lane_limit_table.best_limit(LEDGER, WINDOW)).toBe(LOW)
	})

	it('skips a limit held for fewer active hours than the minimum', () => {
		const burst = [limit(0.9, SHORT), ...samples(0, 0), ...merges(5, 0.9, 0.1)]
		const short_burst = [
			...LEDGER.filter((entry) => Date.parse(entry.at) < NOW - MS_PER_HOUR),
			...burst,
		]

		expect(lane_limit_table.best_limit(short_burst, WINDOW)).toBe(LOW)
	})

	it('keeps the lower limit on a tie', () => {
		const tied = [...LEDGER, ...merges(9, 10, 1)]

		expect(lane_limit_table.best_limit(tied, WINDOW)).toBe(LOW)
	})

	it('picks none when no limit held long enough', () => {
		expect(lane_limit_table.best_limit([limit(2, LOW), ...samples(2, 0)], WINDOW)).toBeUndefined()
	})
})

describe('lane_limit_table.table', () => {
	it('prints one row per limit and the pick under them', () => {
		const text = lane_limit_table.table(LEDGER, WINDOW)

		expect(text).toContain(`| ${String(LOW)} | 1 | 18 | 2.0 |`)
		expect(text).toContain(`| ${String(HIGH)} | 1 | 9 | 1.0 |`)
		expect(text.split('\n').at(-1)).toMatch(/: 4$/u)
	})
})
