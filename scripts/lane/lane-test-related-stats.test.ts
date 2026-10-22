import { describe, expect, it } from 'vitest'
import type { LedgerEntry, TestRelatedRecord } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats } from './lane-stats'
import { lane_test_related_stats } from './lane-test-related-stats'

// joshuafolkken/kit#4465: one ledger period reduces to a row per `josh test:related` scope — its runs
// and the medians of its input, of the test files vitest ran and of its duration.

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const OUTSIDE = '2026-10-20T12:00:00.000Z'
const WINDOW = lane_stats.window_of(1, NOW)
const RELATED = 'related'
const NO_MAP = 'no-map'
const { NOT_MEASURED } = lane_stage_stats

const NARROW: TestRelatedRecord = {
	scope: RELATED,
	changed: 2,
	synced: 0,
	since_map: 0,
	readers: 1,
	test_files: 10,
	elapsed_ms: 20_000,
}

function run(record: TestRelatedRecord, at = AT): LedgerEntry {
	return { kind: 'test-related', at, ...record }
}

// The cells of one scope's row, without the scope name.
function row_of(entries: ReadonlyArray<LedgerEntry>, scope: string): Array<string> | undefined {
	return lane_test_related_stats
		.table(entries, WINDOW)
		.split('\n')
		.map((line) => line.slice(2, -2).split(' | '))
		.find(([first]) => first === scope)
		?.slice(1)
}

describe('lane_test_related_stats.table', () => {
	it('reduces a scope to its runs and the medians of its input, test files and seconds', () => {
		const entries = [
			run(NARROW),
			run({ ...NARROW, changed: 4, synced: 30, since_map: 8, test_files: 30, elapsed_ms: 60_000 }),
			run({ ...NARROW, changed: 6, synced: 60, since_map: 9, test_files: 50, elapsed_ms: 100_000 }),
		]

		expect(row_of(entries, RELATED)).toStrictEqual(['3', '4', '30', '8', '1', '30', '60.0'])
	})

	it('keeps each scope on its own row', () => {
		const full = { ...NARROW, scope: NO_MAP, test_files: 1790 }

		expect(row_of([run(NARROW), run(full)], NO_MAP)).toStrictEqual([
			'1',
			'2',
			'0',
			'0',
			'1',
			'1790',
			'20.0',
		])
	})

	it('prints the test files as not measured where no run reported them', () => {
		const unreported = { ...NARROW, scope: 'none', test_files: undefined }

		expect(row_of([run(unreported)], 'none')?.[5]).toBe(NOT_MEASURED)
	})

	it('leaves out runs outside the window', () => {
		expect(row_of([run(NARROW, OUTSIDE)], RELATED)).toBeUndefined()
	})
})
