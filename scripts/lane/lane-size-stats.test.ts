import { describe, expect, it } from 'vitest'
import type { LedgerEntry, SizeEntry } from './lane-ledger-schema'
import { lane_size_stats } from './lane-size-stats'
import { lane_stats } from './lane-stats'
import { lane_table_rows } from './lane-table-rows'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const WINDOW = lane_stats.window_of(1, NOW)
const BEFORE = '2026-10-28T12:00:00Z'
const DURING = '2026-10-30T11:00:00Z'
const EMPTY_ROW = '| 0 | — | — | 0 |'
// Past the 12-file cap; `lines` stays at the 300-line cap, which is not past it.
const OVER_CAP_FILES = 14
const CAP_LINES = 300
const MISS_HEADER = 'pre-split miss |'

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

function text_of(entries: ReadonlyArray<LedgerEntry>, options = lane_table_rows.ALL_ROWS): string {
	return lane_size_stats.table(entries, WINDOW, options)
}

function row(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return text_of(entries).split('\n', 3)[2]
}

function missed_lanes(count: number): Array<LedgerEntry> {
	return Array.from({ length: count }, (_, index) => [
		{ ...size(index + 1, OVER_CAP_FILES, CAP_LINES), missed: true },
		merge(index + 1),
	]).flat()
}

describe('lane_size_stats.table', () => {
	it('takes the median of per-lane ratios, using measurements before the window', () => {
		expect(row([size(1, 4, 300), size(2, 8, 500), merge(1), merge(2)])).toBe(
			'| 2 | 3.0 | 4.0 | 0 |',
		)
	})

	it('ignores unmerged lanes, merges outside the window and measurements after merge', () => {
		const future = { ...size(3, 20, 1000), at: '2026-10-30T11:30:00Z' }

		expect(row([size(1, 4, 300), size(2, 8, 500), merge(2, BEFORE), future, merge(3)])).toBe(
			EMPTY_ROW,
		)
	})

	it('uses the latest measurement on retries regardless of input order', () => {
		const latest = { ...size(1, 8, 500), at: DURING }

		expect(row([latest, size(1, 4, 300), merge(1)])).toBe('| 1 | 4.0 | 5.0 | 0 |')
	})

	it('omits ratios with zero declarations while preserving zero actual changes', () => {
		const zero = { ...size(1, 0, 0), declared: { files: 0, lines: 100 } }

		expect(row([zero, merge(1)])).toBe('| 1 | — | 0.0 | 0 |')
		expect(row([])).toBe(EMPTY_ROW)
	})
})

// joshuafolkken/kit#7183: a merge recorded `missed` past the split cap is a pre-split miss, counted and
// listed with its declared and actual size.
describe('lane_size_stats.table pre-split misses', () => {
	it('counts the missed merges and lists each with its declared and actual size', () => {
		const missed = { ...size(1, OVER_CAP_FILES, CAP_LINES), missed: true }
		const lines = text_of([missed, size(2, 2, 100), merge(1), merge(2)], { is_all: false })

		expect(lines.split('\n')).toStrictEqual([
			'| measured lanes | files actual / declared median | lines actual / declared median | pre-split misses |',
			'| --- | --- | --- | --- |',
			'| 2 | 4.0 | 2.0 | 1 |',
			'',
			'| pre-split miss | files declared → actual | lines declared → actual |',
			'| --- | --- | --- |',
			'| #1 | 2 → 14 | 100 → 300 |',
		])
	})

	it('prints no miss table when no merge missed', () => {
		expect(text_of([size(1, 2, 100), merge(1)])).not.toContain(MISS_HEADER)
	})

	// joshuafolkken/kit#7578: the miss list is capped by default, every row with --all.
	it('lists the first MISS_ROWS misses and a count of the rest by default', () => {
		const lines = text_of(missed_lanes(lane_size_stats.MISS_ROWS + 2), { is_all: false })

		expect(lines).toContain(`| #${String(lane_size_stats.MISS_ROWS)} | 2 → 14 | 100 → 300 |`)
		expect(lines).not.toContain(`| #${String(lane_size_stats.MISS_ROWS + 1)} |`)
		expect(lines).toContain('… 2 more rows omitted')
	})

	it('lists every miss with --all', () => {
		const lines = text_of(missed_lanes(lane_size_stats.MISS_ROWS + 2))

		expect(lines).toContain(`| #${String(lane_size_stats.MISS_ROWS + 2)} | 2 → 14 | 100 → 300 |`)
		expect(lines).not.toContain('omitted')
	})
})

// joshuafolkken/kit#7579: only a flag past the cap counts, so a flag recorded before the cap took over,
// past the notice bar alone, does not.
describe('lane_size_stats.table pre-split miss cap', () => {
	it('does not count a merge recorded missed at or under the cap', () => {
		const stale = { ...size(1, 12, CAP_LINES), missed: true }

		expect(row([stale, merge(1)])).toBe('| 1 | 6.0 | 3.0 | 0 |')
		expect(text_of([stale, merge(1)])).not.toContain(MISS_HEADER)
	})

	it('does not count a merge past the cap that was not recorded missed', () => {
		expect(row([size(1, OVER_CAP_FILES, CAP_LINES), merge(1)])).toBe('| 1 | 7.0 | 3.0 | 0 |')
	})
})

// joshuafolkken/kit#5568: the lines median `lane:plan` projects a declaration with.
describe('lane_size_stats.lines_ratio', () => {
	it('answers the median lines ratio of the merged lanes, none on an empty period', () => {
		expect(lane_size_stats.lines_ratio([size(1, 4, 300), merge(1)], WINDOW)).toBe(3)
		expect(lane_size_stats.lines_ratio([], WINDOW)).toBeUndefined()
	})
})

describe('lane_size_stats.ratios', () => {
	it('uses separate medians from the same merged lanes (ac-4b828b0f)', () => {
		const entries = [size(1, 2, 300), size(2, 8, 100), merge(1), merge(2)]

		expect(lane_size_stats.ratios(entries, WINDOW)).toEqual({ files: 2.5, lines: 2 })
	})

	it('omits only the axis with no declaration and preserves measured zero (ac-45cdc50c)', () => {
		const zero = { ...size(1, 0, 0), declared: { files: 0, lines: 100 } }

		expect(lane_size_stats.ratios([zero, merge(1)], WINDOW)).toEqual({ lines: 0 })
		expect(lane_size_stats.ratios([], WINDOW)).toEqual({})
	})
})
