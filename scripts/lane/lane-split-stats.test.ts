import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_split_stats } from './lane-split-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#4695: one period's split notices reduce to the lanes they reached and how many of
// those split.

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const OUTSIDE_MINUTES = 2 * 24 * 60

function at(minutes_before: number): string {
	return new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString()
}

function notice(issue: number, minutes_before = 10): LedgerEntry {
	return { kind: 'split-notice', at: at(minutes_before), issue, files: 12, lines: 583 }
}

function split(issue: number, minutes_before = 5): LedgerEntry {
	return { kind: 'split-filed', at: at(minutes_before), issue, child: '#9' }
}

function row_of(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return lane_split_stats.table(entries, WINDOW).split('\n', 3)[2]
}

describe('lane_split_stats.table', () => {
	it('counts the noticed lanes of the period and the ones that split', () => {
		const entries = [notice(1), notice(2), split(2), notice(3, OUTSIDE_MINUTES), split(3)]

		expect(row_of(entries)).toBe('| 2 | 1 |')
	})

	it('counts a split child filed before the period', () => {
		expect(row_of([split(1, OUTSIDE_MINUTES), notice(1)])).toBe('| 1 | 1 |')
	})

	it('prints zero for a period with no notice', () => {
		expect(lane_split_stats.table([], WINDOW).split('\n')).toStrictEqual([
			'| noticed lanes | split |',
			'| --- | --- |',
			'| 0 | 0 |',
		])
	})
})
