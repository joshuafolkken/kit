import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_ledger, type LedgerEntry, type TestRelatedEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// What widened a `josh test:related` run (joshuafolkken/kit#4465): one row per scope it settled on —
// `related`, `none` or the full-suite fallback kind — with the medians of its input (the change
// itself, what a main sync brought in, what the change since the test-read map's tree joined, the
// readers the map added), of the test files vitest
// ran and of its duration. A `related` row whose test files far outrun its input is vitest widening the
// run on its own.

const DECIMALS = 1
const COLUMNS = [
	'test:related scope',
	'runs',
	'changed',
	'synced',
	'since map',
	'readers',
	'test files',
	'median (s)',
] as const

type CountField = 'changed' | 'synced' | 'since_map' | 'readers'

function is_test_related(entry: LedgerEntry): entry is TestRelatedEntry {
	return entry.kind === lane_ledger.KIND.TEST_RELATED
}

function count_cell(values: ReadonlyArray<number>): string {
	const median = lane_stats.median(values)

	return median === undefined ? lane_stage_stats.NOT_MEASURED : String(median)
}

function seconds_cell(values: ReadonlyArray<number>): string {
	const median = lane_stats.median(values)

	return median === undefined
		? lane_stage_stats.NOT_MEASURED
		: (median / MS_PER_SECOND).toFixed(DECIMALS)
}

function median_of(runs: ReadonlyArray<TestRelatedEntry>, field: CountField): string {
	return count_cell(runs.map((run) => run[field]))
}

function scope_row(scope: string, entries: ReadonlyArray<TestRelatedEntry>): string {
	const runs = entries.filter((entry) => entry.scope === scope)
	const test_files = runs.map((run) => run.test_files).filter((files) => files !== undefined)

	return lane_stats.to_row([
		scope,
		String(runs.length),
		median_of(runs, 'changed'),
		median_of(runs, 'synced'),
		median_of(runs, 'since_map'),
		median_of(runs, 'readers'),
		count_cell(test_files),
		seconds_cell(runs.map((run) => run.elapsed_ms)),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const runs = lane_stats.in_window(entries, window).filter(is_test_related)
	const scopes = [...new Set(runs.map((run) => run.scope))]

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...scopes.map((scope) => scope_row(scope, runs)),
	].join('\n')
}

const lane_test_related_stats = { table }

export { lane_test_related_stats }
