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
const RUNS_COLUMN = 'runs'
const SECONDS_COLUMN = 'median (s)'
const COLUMNS = [
	'test:related scope',
	RUNS_COLUMN,
	'changed',
	'synced',
	'since map',
	'readers',
	'test files',
	SECONDS_COLUMN,
] as const
const TRIGGER_COLUMNS = ['test:related whole-suite trigger', RUNS_COLUMN, SECONDS_COLUMN] as const

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

function rows_under(columns: ReadonlyArray<string>, rows: ReadonlyArray<string>): string {
	return [lane_stats.to_row(columns), lane_stats.to_row(columns.map(() => '---')), ...rows].join(
		'\n',
	)
}

function runs_in(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
): Array<TestRelatedEntry> {
	return lane_stats.in_window(entries, window).filter(is_test_related)
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const runs = runs_in(entries, window)
	const scopes = [...new Set(runs.map((run) => run.scope))]

	return rows_under(
		COLUMNS,
		scopes.map((scope) => scope_row(scope, runs)),
	)
}

interface TriggerRuns {
	file: string
	runs: ReadonlyArray<TestRelatedEntry>
}

function runs_sent_by(file: string, runs: ReadonlyArray<TestRelatedEntry>): TriggerRuns {
	return { file, runs: runs.filter((run) => run.trigger_files?.includes(file) === true) }
}

function trigger_row({ file, runs }: TriggerRuns): string {
	return lane_stats.to_row([
		file,
		String(runs.length),
		seconds_cell(runs.map((run) => run.elapsed_ms)),
	])
}

// Which changed file sent a run to the whole suite, most runs first (joshuafolkken/kit#4510): the
// table `WHOLE_SUITE_FILES` and the test-read map are trimmed from. A row written before the files
// were recorded names none, and so counts under no file.
function trigger_table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const runs = runs_in(entries, window)
	const files = [...new Set(runs.flatMap((run) => run.trigger_files ?? []))]
	const triggers = files
		.map((file) => runs_sent_by(file, runs))
		.toSorted((left, right) => right.runs.length - left.runs.length)

	return rows_under(
		TRIGGER_COLUMNS,
		triggers.map((trigger) => trigger_row(trigger)),
	)
}

const lane_test_related_stats = { table, trigger_table }

export { lane_test_related_stats }
