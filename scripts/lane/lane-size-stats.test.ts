import { describe, expect, it } from 'vitest'
import type { LedgerEntry, SizeEntry } from './lane-ledger-schema'
import { lane_size_stats } from './lane-size-stats'
import { lane_stats } from './lane-stats'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const WINDOW = lane_stats.window_of(1, NOW)
const BEFORE = '2026-10-28T12:00:00Z'
const DURING = '2026-10-30T11:00:00Z'
const EMPTY_ROW = '| 0 | — | — |'

function size(issue: number, files: number, lines: number): SizeEntry {
	return {
		kind: 'size',
		at: BEFORE,
		issue,
		declared: { files: 2, lines: 100 },
		actual: { files, lines },
	}
}

function merge(issue: number, at = DURING): LedgerEntry {
	return { kind: 'merge', at, issue }
}

function row(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return lane_size_stats.table(entries, WINDOW).split('\n', 3)[2]
}

describe('lane_size_stats.table', () => {
	it('takes the median of per-lane ratios, using measurements before the window', () => {
		expect(row([size(1, 4, 300), size(2, 8, 500), merge(1), merge(2)])).toBe('| 2 | 3.0 | 4.0 |')
	})

	it('ignores unmerged lanes, merges outside the window and measurements after merge', () => {
		const future = { ...size(3, 20, 1000), at: '2026-10-30T11:30:00Z' }

		expect(row([size(1, 4, 300), size(2, 8, 500), merge(2, BEFORE), future, merge(3)])).toBe(
			EMPTY_ROW,
		)
	})

	it('uses the latest measurement on retries regardless of input order', () => {
		const latest = { ...size(1, 8, 500), at: DURING }

		expect(row([latest, size(1, 4, 300), merge(1)])).toBe('| 1 | 4.0 | 5.0 |')
	})

	it('omits ratios with zero declarations while preserving zero actual changes', () => {
		const zero = { ...size(1, 0, 0), declared: { files: 0, lines: 100 } }

		expect(row([zero, merge(1)])).toBe('| 1 | — | 0.0 |')
		expect(row([])).toBe(EMPTY_ROW)
	})
})
