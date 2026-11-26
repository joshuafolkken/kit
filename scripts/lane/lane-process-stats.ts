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
//
// **The footprint peak counts compressed pages**, which the resident peak leaves out
// (joshuafolkken/kit#7244); a kind whose samples recorded no footprint prints it as missing.

const RSS_PEAK = 'rss peak (GB)'
const SAMPLES = 'samples'
const CPU_MEAN = 'cpu mean (cores)'
const RESERVED_MEAN = 'reserved mean (cores)'
const COLUMNS = [
	'process',
	CPU_MEAN,
	'cpu peak (cores)',
	RSS_PEAK,
	'footprint peak (GB)',
	SAMPLES,
] as const
const RESIDENT_COLUMNS = ['resident apps', 'rss median (GB)', RSS_PEAK, SAMPLES] as const
// Not the names: a sample sums the apps `JOSH_LANE_RESIDENT_APPS` named when it ran, which the ledger does
// not keep, so names read at print time could label sizes another set of apps made (joshuafolkken/kit#5690).
const RESIDENT_LABEL = 'summed'
const OVER_CORES_LABEL = 'load > cores'
const OVERLOAD_COLUMNS = [
	'samples over cores',
	'load mean',
	CPU_MEAN,
	RESERVED_MEAN,
	'cpu − reserved mean (cores)',
	SAMPLES,
] as const
const RESERVED_COLUMNS = ['reserved command (load > cores)', RESERVED_MEAN] as const
const OVER_CORES_PROCESS = 'process (load > cores)'
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

// The largest of `sizes` in gigabytes, `undefined` where none was recorded.
function peak_gb(sizes: ReadonlyArray<number>): number | undefined {
	const peak = lane_stats.peak(sizes)

	return peak === undefined ? undefined : peak / MB_PER_GB
}

function kind_cells(row: KindRow): Array<string> {
	return [
		row.kind,
		cell(mean_cores(row)),
		cell(lane_stats.peak(cores(row.readings))),
		cell(peak_gb(row.readings.map((reading) => reading.rss_mb))),
		cell(peak_gb(row.readings.flatMap((reading) => reading.footprint_mb ?? []))),
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

function kind_table(samples: ReadonlyArray<LoadEntry>, columns: ReadonlyArray<string>): string {
	const rows = group(samples).toSorted(by_mean_cpu)

	return to_table(
		columns,
		rows.map((row) => kind_cells(row)),
	)
}

type OverSample = LoadEntry & {
	cores: NonNullable<LoadEntry['cores']>
	reserved: NonNullable<LoadEntry['reserved']>
	processes: NonNullable<LoadEntry['processes']>
}

function has_readings(sample: LoadEntry): boolean {
	return sample.processes !== undefined && sample.reserved !== undefined
}

// A sample whose one-minute load passed the core count it recorded; one written before the core count
// was recorded, or with no process or reservation reading (a `ps` that timed out), is never counted, so
// a missing reading never reads as zero CPU (joshuafolkken/kit#9000).
function is_over_cores(sample: LoadEntry): sample is OverSample {
	return has_readings(sample) && sample.cores !== undefined && sample.load > sample.cores
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

function cpu_cores(sample: OverSample): number {
	return sum(cores(sample.processes))
}

function reserved_cores(sample: OverSample): number {
	return sum(sample.reserved.map((reserved) => reserved.cores))
}

function overload_row(samples: ReadonlyArray<OverSample>): Array<string> {
	const gaps = samples.map((sample) => cpu_cores(sample) - reserved_cores(sample))

	return [
		OVER_CORES_LABEL,
		cell(lane_stats.mean(samples.map((sample) => sample.load))),
		cell(lane_stats.mean(samples.map((sample) => cpu_cores(sample)))),
		cell(lane_stats.mean(samples.map((sample) => reserved_cores(sample)))),
		cell(lane_stats.mean(gaps)),
		String(samples.length),
	]
}

function command_cores(sample: OverSample, command: string): number {
	const held = sample.reserved.filter((reserved) => reserved.command === command)

	return sum(held.map((reserved) => reserved.cores))
}

// Each command's reserved cores averaged over every over-core sample, a sample it held none in reading 0.
function reserved_rows(samples: ReadonlyArray<OverSample>): Array<Array<string>> {
	const reserved = samples.flatMap((sample) => sample.reserved)
	const commands = [...new Set(reserved.map((entry) => entry.command))]
	const held = commands.map((command) => ({
		command,
		mean: lane_stats.mean(samples.map((sample) => command_cores(sample, command))) ?? 0,
	}))

	return held
		.toSorted((left, right) => right.mean - left.mean)
		.map((row) => [row.command, cell(row.mean)])
}

// **What the load past the cores was made of** (joshuafolkken/kit#9000): over the samples whose load
// passed the core count, the process kinds' CPU beside what the core budget had admitted, so the excess
// reads as work outside the budget or a claim using more than it reserved. The CPU sums only a sample's
// heaviest kinds, so `cpu − reserved` is a floor. A period with no such sample prints nothing.
function overload_tables(samples: ReadonlyArray<LoadEntry>): Array<string> {
	const over = samples.filter(is_over_cores)

	if (over.length === 0) return []

	return [
		to_table(OVERLOAD_COLUMNS, [overload_row(over)]),
		to_table(RESERVED_COLUMNS, reserved_rows(over)),
		kind_table(over, [OVER_CORES_PROCESS, ...COLUMNS.slice(1)]),
	]
}

// The period's table: `entries` is the whole ledger, filtered here to `window`. A period whose samples
// carried no breakdown prints the header alone.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const samples = lane_stats.in_window(entries, window).filter(is_load)

	return [
		kind_table(samples, COLUMNS),
		...resident_tables(samples),
		...overload_tables(samples),
	].join('\n\n')
}

const lane_process_stats = { table }

export { lane_process_stats }
