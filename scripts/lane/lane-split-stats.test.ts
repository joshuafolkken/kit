import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry, SplitNoticeEntry } from './lane-ledger'
import { lane_split_stats } from './lane-split-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#4695: one period's split notices reduce to the lanes they reached and how many of
// those split; joshuafolkken/kit#5568: one row per reason under the `all` row.

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const OUTSIDE_MINUTES = 2 * 24 * 60
const NO_FILES_ROW = '| files | 0 | 0 |'

function at(minutes_before: number): string {
	return new Date(NOW - minutes_before * MS_PER_MINUTE).toISOString()
}

function notice(
	issue: number,
	minutes_before = 10,
	reason?: SplitNoticeEntry['reason'],
): LedgerEntry {
	const entry: LedgerEntry = {
		kind: 'split-notice',
		at: at(minutes_before),
		issue,
		files: 12,
		lines: 583,
	}

	return reason === undefined ? entry : { ...entry, reason }
}

function split(issue: number, minutes_before = 5): LedgerEntry {
	return { kind: 'split-filed', at: at(minutes_before), issue, child: '#9' }
}

function rows_of(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_split_stats.table(entries, WINDOW).split('\n').slice(2)
}

function all_row(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return rows_of(entries)[0]
}

describe('lane_split_stats.table', () => {
	it('counts the noticed lanes of the period and the ones that split', () => {
		const entries = [notice(1), notice(2), split(2), notice(3, OUTSIDE_MINUTES), split(3)]

		expect(all_row(entries)).toBe('| all | 2 | 1 |')
	})

	it('counts a split child filed before the period', () => {
		expect(all_row([split(1, OUTSIDE_MINUTES), notice(1)])).toBe('| all | 1 | 1 |')
	})

	it('prints zero for a period with no notice', () => {
		expect(lane_split_stats.table([], WINDOW).split('\n')).toStrictEqual([
			'| reason | noticed lanes | split |',
			'| --- | --- | --- |',
			'| all | 0 | 0 |',
			NO_FILES_ROW,
			'| hunks | 0 | 0 |',
			'| lines | 0 | 0 |',
			'| diff | 0 | 0 |',
		])
	})
})

describe('lane_split_stats.table by reason', () => {
	it('counts each lane under the reason it was noticed on, a reasonless notice under diff', () => {
		const entries = [
			notice(1, 10, 'hunks'),
			split(1),
			notice(2, 10, 'lines'),
			notice(2, 8, 'hunks'),
			notice(3),
		]

		expect(rows_of(entries)).toStrictEqual([
			'| all | 3 | 1 |',
			NO_FILES_ROW,
			'| hunks | 2 | 1 |',
			'| lines | 1 | 0 |',
			'| diff | 1 | 0 |',
		])
	})
})
