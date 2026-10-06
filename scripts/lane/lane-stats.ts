import type { GateEntry, LedgerEntry, LoadEntry } from './lane-ledger'

// The lane-limit measurement's one table row (joshuafolkken/kit#3355): the ledger entries of one period
// reduced to throughput, gate duration and machine load, in the column order
// `docs/maintainers/lane-limit-measurement.md` documents, so the row pastes into #3347's table as is.
//
// **A column with no samples prints `—`, never `0`.** A period nobody ran the sampler through has no
// load, which is not a load of zero; a zero would be read as an idle machine.
//
// **Throughput is per active hour** — the gaps between consecutive merges and gates no longer than an
// hour — rather than per calendar hour, so the nights between runs in a several-day period do not
// dilute the rate. A first-to-last span would still contain every interior night.

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

// The hours work was under way: the gaps between consecutive work entries (merges and gates) that are
// no longer than `ACTIVE_GAP_MS`. Load samples are left out because the sampler runs through the
// nights; `undefined` when no such gap leaves any active time.
function active_hours(entries: ReadonlyArray<LedgerEntry>): number | undefined {
	const instants = entries
		.filter((entry) => !is_load(entry))
		.map((entry) => Date.parse(entry.at))
		.toSorted((left, right) => left - right)
	const active = instants
		.slice(1)
		.map((instant, index) => instant - (instants[index] ?? instant))
		.filter((gap) => gap <= ACTIVE_GAP_MS)
		.reduce((sum, gap) => sum + gap, 0)

	return active > 0 ? active / MS_PER_HOUR : undefined
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
	const lanes = entries.filter(is_load).map((entry) => entry.lanes)
	const per_hour = hours === undefined ? undefined : merges / hours

	return [String(merges), cell(per_hour), cell(mean(lanes.filter(is_number)))]
}

function gate_cells(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	const minutes = entries.filter(is_gate).map((entry) => entry.elapsed_ms / MS_PER_MINUTE)

	return [cell(median(minutes)), cell(peak(minutes))]
}

function load_cells(samples: ReadonlyArray<LoadEntry>): Array<string> {
	const loads = samples.map((sample) => sample.load)
	const swap = samples.map((sample) => sample.swap_mb).filter(is_number)
	const free = samples.map((sample) => sample.free_mb)

	return [
		cell(peak(loads)),
		cell(mean(loads)),
		cell(gigabytes(peak(swap))),
		cell(gigabytes(mean(swap))),
		cell(gigabytes(lowest(free))),
		cell(gigabytes(mean(free))),
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
