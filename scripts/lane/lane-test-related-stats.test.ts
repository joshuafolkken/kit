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

const WIDE: TestRelatedRecord = {
	...NARROW,
	changed: 6,
	synced: 60,
	since_map: 9,
	test_files: 50,
	elapsed_ms: 100_000,
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

// Runs, the four input counts and the test files; the rebuild, core wait, select and vitest seconds;
// the duration.
const RELATED_ROW = [
	'3',
	'4',
	'30',
	'8',
	'1',
	'30',
	NOT_MEASURED,
	NOT_MEASURED,
	'2.0',
	NOT_MEASURED,
	'60.0',
]
const NO_MAP_ROW = [
	'1',
	'2',
	'0',
	'0',
	'1',
	'1790',
	NOT_MEASURED,
	NOT_MEASURED,
	NOT_MEASURED,
	NOT_MEASURED,
	'20.0',
]

describe('lane_test_related_stats.table', () => {
	it('reduces a scope to its runs and the medians of its input, test files, selection and seconds', () => {
		const entries = [
			run({ ...NARROW, select_elapsed_ms: 1000 }),
			run({ ...NARROW, changed: 4, synced: 30, since_map: 8, test_files: 30, elapsed_ms: 60_000 }),
			run({ ...WIDE, select_elapsed_ms: 3000 }),
		]

		expect(row_of(entries, RELATED)).toStrictEqual(RELATED_ROW)
	})

	it('keeps each scope on its own row', () => {
		const full = { ...NARROW, scope: NO_MAP, test_files: 1790 }

		expect(row_of([run(NARROW), run(full)], NO_MAP)).toStrictEqual(NO_MAP_ROW)
	})

	it('prints the test files as not measured where no run reported them', () => {
		const unreported = { ...NARROW, scope: 'none', test_files: undefined }

		expect(row_of([run(unreported)], 'none')?.[5]).toBe(NOT_MEASURED)
	})

	it('leaves out runs outside the window', () => {
		expect(row_of([run(NARROW, OUTSIDE)], RELATED)).toBeUndefined()
	})
})

// joshuafolkken/kit#7248: the test selection's median, apart from vitest's.
describe('lane_test_related_stats.table — the test selection', () => {
	it('heads the stage columns between the test files and the duration', () => {
		const [header] = lane_test_related_stats.table([], WINDOW).split('\n', 1)

		expect(header).toContain(
			'| test files | rebuild (s) | core wait (s) | select (s) | vitest (s) | median (s) |',
		)
	})

	it('prints the selection as not measured where no run recorded it', () => {
		expect(row_of([run(NARROW)], RELATED)?.[8]).toBe(NOT_MEASURED)
	})
})

// joshuafolkken/kit#7828: the medians of the launcher's rebuild, the core wait and vitest.
describe('lane_test_related_stats.table — the timed stages', () => {
	it('reduces each stage to the median of the runs that recorded it', () => {
		const entries = [
			run({ ...NARROW, rebuild_ms: 4000, core_wait_ms: 1000, vitest_ms: 10_000 }),
			run({ ...NARROW, core_wait_ms: 3000, vitest_ms: 20_000 }),
			run(NARROW),
		]

		expect(row_of(entries, RELATED)?.slice(6, -1)).toStrictEqual([
			'4.0',
			'2.0',
			NOT_MEASURED,
			'15.0',
		])
	})
})

// joshuafolkken/kit#4510: the changed files that sent a run to the whole suite, one row each.
const PACKAGE_FILE = 'package.json'
const LOCK_FILE = 'pnpm-lock.yaml'
const WHOLE: TestRelatedRecord = { ...NARROW, scope: 'whole-suite-file', elapsed_ms: 100_000 }

function trigger_rows(entries: ReadonlyArray<LedgerEntry>): Array<Array<string>> {
	return lane_test_related_stats
		.trigger_table(entries, WINDOW)
		.split('\n')
		.slice(2)
		.map((line) => line.slice(2, -2).split(' | '))
}

describe('lane_test_related_stats.trigger_table', () => {
	it('counts each file under every run it sent there, most runs first, with their median', () => {
		const entries = [
			run({ ...WHOLE, trigger_files: [PACKAGE_FILE, LOCK_FILE], elapsed_ms: 200_000 }),
			run({ ...WHOLE, trigger_files: [LOCK_FILE] }),
			run({ ...WHOLE, trigger_files: [LOCK_FILE], elapsed_ms: 150_000 }),
		]

		expect(trigger_rows(entries)).toStrictEqual([
			[LOCK_FILE, '3', '150.0'],
			[PACKAGE_FILE, '1', '200.0'],
		])
	})

	it('reads a row written before the files were recorded as naming none', () => {
		expect(trigger_rows([run(WHOLE), run(NARROW)])).toStrictEqual([])
	})

	it('counts no file a run outside the window named', () => {
		expect(trigger_rows([run({ ...WHOLE, trigger_files: [LOCK_FILE] }, OUTSIDE)])).toStrictEqual([])
	})
})
