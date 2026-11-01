import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import type { ProcessKind } from './lane-process-load'
import { lane_process_stats } from './lane-process-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#3874: a period's load samples reduce to one row per process kind, so the load the
// core budget's ledger does not explain is read back by what made it.

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_DAY = 86_400_000
const HEADER_LINES = 2

function sample(at_ms: number, processes?: Array<ProcessKind>): LedgerEntry {
	return { kind: 'load', at: new Date(at_ms).toISOString(), load: 10, processes }
}

function rows_of(table: string): Array<string> {
	return table.split('\n').slice(HEADER_LINES)
}

describe('lane_process_stats.table', () => {
	it('averages each kind over the samples it appears in, heaviest first', () => {
		const entries = [
			sample(NOW - 2, [
				{ kind: 'eslint', cpu_percent: 100, rss_mb: 1024, count: 2 },
				{ kind: 'vitest', cpu_percent: 400, rss_mb: 2048, count: 8 },
			]),
			sample(NOW - 1, [{ kind: 'vitest', cpu_percent: 200, rss_mb: 3072, count: 6 }]),
		]

		expect(rows_of(lane_process_stats.table(entries, WINDOW))).toStrictEqual([
			'| vitest | 3.0 | 4.0 | 3.0 | 2 |',
			'| eslint | 1.0 | 1.0 | 1.0 | 1 |',
		])
	})

	it('leaves out samples outside the period', () => {
		const entries = [
			sample(NOW - 2 * MS_PER_DAY, [{ kind: 'tsc', cpu_percent: 100, rss_mb: 512, count: 1 }]),
		]

		expect(rows_of(lane_process_stats.table(entries, WINDOW))).toStrictEqual([])
	})

	it('prints the header alone when no sample carried a breakdown', () => {
		const table = lane_process_stats.table([sample(NOW - 1)], WINDOW)

		expect(table.split('\n')).toHaveLength(HEADER_LINES)
		expect(table).toContain('cpu mean (cores)')
	})
})

// joshuafolkken/kit#5658: the resident apps' size beside the load, to compare a day they were closed.
describe('lane_process_stats.table resident apps', () => {
	it('prints the resident apps median and peak beside the samples that recorded them', () => {
		const entries = [1024, 3072, 2048, undefined].map((resident_mb, index) => ({
			...sample(NOW - index - 1),
			resident_mb,
		}))
		const [, resident = ''] = lane_process_stats.table(entries, WINDOW).split('\n\n', 2)

		expect(resident.split('\n')).toStrictEqual([
			'| resident apps | rss median (GB) | rss peak (GB) | samples |',
			'| --- | --- | --- | --- |',
			'| summed | 2.0 | 3.0 | 3 |',
		])
	})

	it('leaves the output unchanged when no sample recorded the resident apps', () => {
		const processes = [{ kind: 'vitest', cpu_percent: 100, rss_mb: 1024, count: 1 }]
		const table = lane_process_stats.table([sample(NOW - 1, processes)], WINDOW)

		expect(table.split('\n')).toStrictEqual([
			'| process | cpu mean (cores) | cpu peak (cores) | rss peak (GB) | samples |',
			'| --- | --- | --- | --- | --- |',
			'| vitest | 1.0 | 1.0 | 1.0 | 1 |',
		])
	})
})
