import { describe, expect, it } from 'vitest'
import { lane_estimate_ratio } from './lane-estimate-ratio'
import type { LedgerEntry } from './lane-ledger'

// joshuafolkken/kit#7775: each finished run's estimate set against its actual end — the last merge of
// the children its records were written for.

const MS_PER_HOUR = 3_600_000
const NOW = Date.parse('2026-11-17T12:00:00.000Z')
const WINDOW = { since_ms: NOW - 24 * MS_PER_HOUR, until_ms: NOW }
const RUN = '2026-11-17T00:00:00.000Z'
const FIRST = 1
const SECOND = 2

function at(hours: number): string {
	return new Date(NOW - hours * MS_PER_HOUR).toISOString()
}

function estimate(issue: number, hours: number, finish_hours: number): LedgerEntry {
	return { kind: 'estimate', at: at(hours), issue, run: RUN, finish_at: at(finish_hours) }
}

function merge(issue: number, hours: number): LedgerEntry {
	return { kind: 'merge', at: at(hours), issue }
}

describe('lane_estimate_ratio.ratios_of', () => {
	it('gives the first record its ratio and keeps every record for the median', () => {
		// The run ends at the last merge, 2 h ago. First: 4 h expected, 8 h taken → 2. Second: 2 h
		// expected, 4 h taken → 2.
		const entries = [
			estimate(FIRST, 10, 6),
			estimate(SECOND, 6, 4),
			merge(FIRST, 5),
			merge(SECOND, 2),
		]

		expect(lane_estimate_ratio.ratios_of(entries, WINDOW)).toEqual([{ first: 2, all: [2, 2] }])
	})

	it('leaves out a run with a child not merged', () => {
		const entries = [estimate(FIRST, 10, 6), estimate(SECOND, 6, 4), merge(FIRST, 5)]

		expect(lane_estimate_ratio.ratios_of(entries, WINDOW)).toEqual([])
	})

	it('leaves out a run that ended before the window', () => {
		const entries = [estimate(FIRST, 40, 36), merge(FIRST, 30)]

		expect(lane_estimate_ratio.ratios_of(entries, WINDOW)).toEqual([])
	})

	it('reads nothing from a ledger with no estimate', () => {
		expect(lane_estimate_ratio.ratios_of([merge(FIRST, 5)], WINDOW)).toEqual([])
	})
})
