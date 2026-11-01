import type { LedgerEntry, LoadEntry } from './lane-ledger'
import type { ProcessKind } from './lane-process-load'
import { lane_stats, type StatsWindow } from './lane-stats'

// What the period's machine load was made of: the process kinds the load samples carried
// (`lane-process-load.ts`), one row per kind, printed by `josh lane:stats` under the stop table so the
// load the core budget's ledger does not explain is read back by what made it (joshuafolkken/kit#3874).
//
// **A kind is averaged over the samples it appears in**, never over every sample. A sample keeps only
// its heaviest kinds, so a kind absent from one was below them rather than idle, and a zero there would
// understate it; `samples` says how often it was among the heaviest, which is the weight to read it by.
//
// **CPU is in cores** — `ps`'s share of one core over a hundred — so the column reads against the load
// average and the machine's core count without a conversion.

const RSS_PEAK = 'rss peak (GB)'
const SAMPLES = 'samples'
const COLUMNS = ['process', 'cpu mean (cores)', 'cpu peak (cores)', RSS_PEAK, SAMPLES] as const
const RESIDENT_COLUMNS = ['resident apps', 'rss median (GB)', RSS_PEAK, SAMPLES] as const
// Not the names: a sample sums the apps `JOSH_LANE_RESIDENT_APPS` named when it ran, which the ledger does
// not keep, so names read at print time could label sizes another set of apps made (joshuafolkken/kit#5690).
const RESIDENT_LABEL = 'summed'
const PERCENT_PER_CORE = 100
const MB_PER_GB = 1024
const DECIMALS = 1

interface KindRow {
	kind: string
	readings: Array<ProcessKind>
}

function is_load(entry: LedgerEntry): entry is LoadEntry {
	return entry.kind === 'load'
}

function group(samples: ReadonlyArray<LoadEntry>): Array<KindRow> {
	const rows = new Map<string, KindRow>()
	const readings = samples.flatMap((sample) => sample.processes ?? [])

	for (const reading of readings) {
		const row = rows.get(reading.kind) ?? { kind: reading.kind, readings: [] }

		row.readings.push(reading)
		rows.set(reading.kind, row)
	}

	return [...rows.values()]
}

function cores(readings: ReadonlyArray<ProcessKind>): Array<number> {
	return readings.map((reading) => reading.cpu_percent / PERCENT_PER_CORE)
}

// A row has one reading at least, so its mean always exists.
function mean_cores(row: KindRow): number {
	return lane_stats.mean(cores(row.readings)) ?? 0
}

function cell(value: number | undefined): string {
	return value === undefined ? lane_stats.MISSING : value.toFixed(DECIMALS)
}

function kind_cells(row: KindRow): Array<string> {
	const rss_peak = lane_stats.peak(row.readings.map((reading) => reading.rss_mb))

	return [
		row.kind,
		cell(mean_cores(row)),
		cell(lane_stats.peak(cores(row.readings))),
		cell(rss_peak === undefined ? undefined : rss_peak / MB_PER_GB),
		String(row.readings.length),
	]
}

function by_mean_cpu(left: KindRow, right: KindRow): number {
	return mean_cores(right) - mean_cores(left)
}

function to_table(columns: ReadonlyArray<string>, rows: ReadonlyArray<Array<string>>): string {
	return [
		lane_stats.to_row(columns),
		lane_stats.to_row(columns.map(() => '---')),
		...rows.map((row) => lane_stats.to_row(row)),
	].join('\n')
}

// The resident apps' summed size over the samples that recorded it (joshuafolkken/kit#5658), so a period
// run with the IDE and browser closed reads against one run with them open. Older samples carry none,
// and a period with none prints no table, leaving the output as it was.
function resident_tables(samples: ReadonlyArray<LoadEntry>): Array<string> {
	const sizes = samples.flatMap((sample) => sample.resident_mb ?? [])

	if (sizes.length === 0) return []

	const gigabytes = sizes.map((size) => size / MB_PER_GB)
	const row = [RESIDENT_LABEL, cell(lane_stats.median(gigabytes)), cell(lane_stats.peak(gigabytes))]

	return [to_table(RESIDENT_COLUMNS, [[...row, String(sizes.length)]])]
}

// The period's table: `entries` is the whole ledger, filtered here to `window`. A period whose samples
// carried no breakdown prints the header alone.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const samples = lane_stats.in_window(entries, window).filter(is_load)
	const rows = group(samples).toSorted(by_mean_cpu)

	return [
		to_table(
			COLUMNS,
			rows.map((row) => kind_cells(row)),
		),
		...resident_tables(samples),
	].join('\n\n')
}

const lane_process_stats = { table }

export { lane_process_stats }
