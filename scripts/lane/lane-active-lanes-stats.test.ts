import { describe, expect, it } from 'vitest'
import { lane_active_lanes_stats } from './lane-active-lanes-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

const START = Date.parse('2026-11-26T00:00:00.000Z')
const MINUTE_MS = 60_000
const NOW = START + 10 * MINUTE_MS
const WINDOW = lane_stats.window_of(1, NOW)
const CORES = 10
const MB_PER_GB = 1024

function iso(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function sample(minute: number, lanes: number, load: number): LedgerEntry {
	return {
		kind: 'load',
		at: iso(minute),
		load,
		lanes,
		cores: CORES,
		available_mb: load * MB_PER_GB,
	}
}

function merge(minute: number, issue: number): LedgerEntry {
	return { kind: 'merge', at: iso(minute), issue }
}

function limit(minute: number, value: number): LedgerEntry {
	return { kind: 'limit', at: iso(minute), limit: value }
}

// Under a limit of 6: 4 lanes for minutes 0–6, then 6 lanes for minutes 6–9; a last sample at 9.
const LEDGER: ReadonlyArray<LedgerEntry> = [
	limit(0, 6),
	sample(0, 4, 8),
	sample(3, 4, 12),
	sample(6, 6, 8),
	sample(9, 6, 16),
	merge(4, 1),
	merge(7, 2),
	merge(8, 3),
]

function rows_of(table: string): Array<Array<string>> {
	return table
		.split('\n')
		.filter((line) => line.startsWith('| ') && !line.includes('---'))
		.slice(1)
		.map((line) =>
			line
				.split('|')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		)
}

describe('lane_active_lanes_stats.table', () => {
	it('files time under a limit of 6 that ran 4 lanes in the 4-lane row', () => {
		const rows = rows_of(lane_active_lanes_stats.table(LEDGER, WINDOW))

		expect(rows.map((row) => row[0])).toStrictEqual(['4', '6'])
		expect(rows[0]?.slice(1, 3)).toStrictEqual(['0.10', '1'])
	})

	it('counts a merge under the lanes of the latest sample at or before it', () => {
		const rows = rows_of(lane_active_lanes_stats.table(LEDGER, WINDOW))

		expect(rows.map((row) => row[2])).toStrictEqual(['1', '2'])
		expect(lane_active_lanes_stats.table(LEDGER, WINDOW)).toContain(
			'latest load sample at or before it',
		)
	})

	it('counts a merge in a sample gap the row’s hours count, past five minutes', () => {
		const ledger = [limit(0, 6), sample(0, 4, 8), sample(30, 4, 8), merge(20, 1)]
		const rows = rows_of(
			lane_active_lanes_stats.table(ledger, lane_stats.window_of(1, START + 40 * MINUTE_MS)),
		)

		expect(rows.map((row) => row.slice(0, 3))).toStrictEqual([['4', '0.50', '1']])
	})

	it('reads load mean, peak, the share over cores and free memory per row', () => {
		const rows = rows_of(lane_active_lanes_stats.table(LEDGER, WINDOW))

		expect(rows[1]?.slice(3)).toStrictEqual(['40.0', '12.0', '16.0', '50.0', '12.0', '8.0'])
	})

	it('prints the header alone over a period without samples', () => {
		expect(rows_of(lane_active_lanes_stats.table([], WINDOW))).toStrictEqual([])
	})
})

describe('lane_active_lanes_stats.filled_table', () => {
	it('keeps only the time at least the limit’s lanes were active', () => {
		const rows = rows_of(lane_active_lanes_stats.filled_table(LEDGER, WINDOW))

		expect(rows.map((row) => row.slice(0, 3))).toStrictEqual([['6', '0.05', '2']])
	})

	it('files a filled stretch under the limit in force, not a later one', () => {
		const ledger = [...LEDGER, limit(9, 4), sample(12, 4, 8), sample(15, 4, 8)]
		const window = lane_stats.window_of(1, START + 20 * MINUTE_MS)
		const rows = rows_of(lane_active_lanes_stats.filled_table(ledger, window))

		expect(rows.map((row) => row.slice(0, 2))).toStrictEqual([
			['4', '0.10'],
			['6', '0.05'],
		])
	})

	it('leaves out samples written before any limit line', () => {
		const ledger = LEDGER.filter((entry) => entry.kind !== 'limit')

		expect(rows_of(lane_active_lanes_stats.filled_table(ledger, WINDOW))).toStrictEqual([])
	})
})
