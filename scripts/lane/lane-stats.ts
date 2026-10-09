import type { GateEntry, LedgerEntry, LoadEntry } from './lane-ledger'

// The lane-limit measurement's one table row: the ledger entries of one period
// reduced to throughput, gate duration and machine load, in the column order
// `docs/maintainers/lane-limit-measurement.md` documents, so the row pastes into #3347's table as is.
//
// **A column with no samples prints `—`, never `0`.** A period nobody ran the sampler through has no
// load, which is not a load of zero; a zero would be read as an idle machine.
//
// **Throughput is per active hour** — the time load samples saw a lane child working — rather than per
// calendar hour, so the nights between runs in a several-day period do not dilute the rate. The gaps
// between work entries cannot stand in for it: at a low limit the gap from one merge to the next child's
// first gate is a whole implementation, which a gap cap drops, inflating exactly the low limits' rate.
// Only a period no sample saw working falls back to the gaps of up to an hour between merges and gates.
//
// **The means take working samples only** for the same reason: the sampler runs through the nights,
// and their idle samples would read four busy lanes as about one. Peaks and minima take every sample.

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
// A busy lane pool finishes a gate well within this; a longer silence is time nobody was running work.
const ACTIVE_GAP_MS = MS_PER_HOUR
const MS_PER_DAY = 86_400_000
const MB_PER_GB = 1024
const HALF = 2
const DECIMALS = 1
const MISSING = '—'
const CELL_SEPARATOR = ' | '

const COLUMNS = [
	'JOSH_LANE_LIMIT',
	'period (days)',
	'merges',
	'merges / hour',
	'effective lanes',
	'gate median (min)',
	'gate max (min)',
	'load peak',
	'load mean',
	'swap peak (GB)',
	'swap mean (GB)',
	'free memory min (GB)',
	'free memory mean (GB)',
	'load samples',
] as const

interface StatsWindow {
	since_ms: number
	until_ms: number
}

interface RowLabel {
	limit: string
	period_days: number
}

function window_of(period_days: number, now_ms: number): StatsWindow {
	return { since_ms: now_ms - period_days * MS_PER_DAY, until_ms: now_ms }
}

function in_window(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<LedgerEntry> {
	return entries.filter((entry) => {
		const at = Date.parse(entry.at)

		return at >= window.since_ms && at <= window.until_ms
	})
}

function is_gate(entry: LedgerEntry): entry is GateEntry {
	return entry.kind === 'gate'
}

function is_load(entry: LedgerEntry): entry is LoadEntry {
	return entry.kind === 'load'
}

function is_number(value: number | undefined): value is number {
	return value !== undefined
}

function mean(values: ReadonlyArray<number>): number | undefined {
	if (values.length === 0) return undefined

	return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: ReadonlyArray<number>): number | undefined {
	if (values.length === 0) return undefined

	const sorted = values.toSorted((left, right) => left - right)
	const middle = Math.floor(sorted.length / HALF)

	return sorted.length % HALF === 0 ? mean(sorted.slice(middle - 1, middle + 1)) : sorted[middle]
}

function peak(values: ReadonlyArray<number>): number | undefined {
	return values.length === 0 ? undefined : Math.max(...values)
}

function lowest(values: ReadonlyArray<number>): number | undefined {
	return values.length === 0 ? undefined : Math.min(...values)
}

type WorkingEntry = LoadEntry & { lanes: number }

function is_working(sample: LoadEntry): sample is WorkingEntry {
	return (sample.lanes ?? 0) > 0
}

function sum_hours(gaps: ReadonlyArray<number>): number | undefined {
	const active = gaps.filter((gap) => gap <= ACTIVE_GAP_MS).reduce((sum, gap) => sum + gap, 0)

	return active > 0 ? active / MS_PER_HOUR : undefined
}

// The fallback for a period no sampler saw working: the gaps between consecutive work entries (merges
// and gates) no longer than `ACTIVE_GAP_MS`.
function gap_hours(entries: ReadonlyArray<LedgerEntry>): number | undefined {
	const instants = entries
		.filter((entry) => !is_load(entry))
		.map((entry) => Date.parse(entry.at))
		.toSorted((left, right) => left - right)

	return sum_hours(
		instants.slice(1).map((instant, index) => instant - (instants[index] ?? instant)),
	)
}

// The time from each working sample to the next sample. The cap still applies, so a sampler stopped
// mid-run does not count its silence as work.
function sampled_hours(samples: ReadonlyArray<LoadEntry>): number | undefined {
	const sorted = samples.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
	const gaps = sorted
		.slice(1)
		.map((next, index) => ({ sample: sorted[index] ?? next, next }))
		.filter(({ sample }) => is_working(sample))
		.map(({ sample, next }) => Date.parse(next.at) - Date.parse(sample.at))

	return sum_hours(gaps)
}

// The hours work was under way; `undefined` when nothing leaves any active time.
function active_hours(entries: ReadonlyArray<LedgerEntry>): number | undefined {
	const samples = entries.filter(is_load)

	return samples.some((sample) => is_working(sample)) ? sampled_hours(samples) : gap_hours(entries)
}

function gigabytes(megabytes: number | undefined): number | undefined {
	return megabytes === undefined ? undefined : megabytes / MB_PER_GB
}

function cell(value: number | undefined): string {
	return value === undefined ? MISSING : value.toFixed(DECIMALS)
}

function throughput_cells(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	const merges = entries.filter((entry) => entry.kind === 'merge').length
	const hours = active_hours(entries)
	const lanes = entries
		.filter(is_load)
		.filter(is_working)
		.map((entry) => entry.lanes)
	const per_hour = hours === undefined ? undefined : merges / hours

	return [String(merges), cell(per_hour), cell(mean(lanes))]
}

function gate_cells(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	const minutes = entries.filter(is_gate).map((entry) => entry.elapsed_ms / MS_PER_MINUTE)

	return [cell(median(minutes)), cell(peak(minutes))]
}

function load_cells(samples: ReadonlyArray<LoadEntry>): Array<string> {
	const working = samples.filter(is_working)
	const swap = samples.map((sample) => sample.swap_mb).filter(is_number)
	const working_swap = working.map((sample) => sample.swap_mb).filter(is_number)
	const free = samples.map((sample) => sample.free_mb)
	const working_free = working.map((sample) => sample.free_mb)

	return [
		cell(peak(samples.map((sample) => sample.load))),
		cell(mean(working.map((sample) => sample.load))),
		cell(gigabytes(peak(swap))),
		cell(gigabytes(mean(working_swap))),
		cell(gigabytes(lowest(free))),
		cell(gigabytes(mean(working_free))),
		String(samples.length),
	]
}

function to_row(cells: ReadonlyArray<string>): string {
	return `| ${cells.join(CELL_SEPARATOR)} |`
}

function header(): string {
	return [to_row(COLUMNS), to_row(COLUMNS.map(() => '---'))].join('\n')
}

// The period's row: `entries` is the whole ledger, filtered here to `window`.
function row(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow, label: RowLabel): string {
	const period = in_window(entries, window)

	return to_row([
		label.limit,
		String(label.period_days),
		...throughput_cells(period),
		...gate_cells(period),
		...load_cells(period.filter(is_load)),
	])
}

const lane_stats = {
	COLUMNS,
	MISSING,
	header,
	median,
	row,
	window_of,
}

export type { RowLabel, StatsWindow }
export { lane_stats }
