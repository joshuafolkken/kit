import type { LedgerEntry, MergeEntry } from './lane-ledger'
import type { EstimateEntry } from './lane-ledger-schema-estimate'
import type { StatsWindow } from './lane-stats'

// How far each run's finish estimate (`estimate` ledger rows, joshuafolkken/kit#7775) was off: per
// record, the time the run actually had left over the time it was expected to have left. A run ends
// at the last merge of the children its records were written for; a child left unmerged (parked,
// closed or skipped) does not hold the end back, and a run with no merged child has no actual end and
// is left out. Only runs that ended in the window count.

interface RunRatios {
	first: number
	all: Array<number>
}

function is_estimate(entry: LedgerEntry): entry is EstimateEntry {
	return entry.kind === 'estimate'
}

function is_merge(entry: LedgerEntry): entry is MergeEntry {
	return entry.kind === 'merge'
}

function is_number(value: number | undefined): value is number {
	return value !== undefined
}

// Each run's records, oldest first.
function runs_of(estimates: ReadonlyArray<EstimateEntry>): Array<Array<EstimateEntry>> {
	const runs = new Map<string, Array<EstimateEntry>>()

	for (const estimate of estimates) {
		runs.set(estimate.run, [...(runs.get(estimate.run) ?? []), estimate])
	}

	return [...runs.values()].map((records) =>
		records.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at)),
	)
}

// The issue's first merge at or after the run's first record.
function merged_ms(
	issue: number,
	since_ms: number,
	merges: ReadonlyArray<MergeEntry>,
): number | undefined {
	const instants = merges
		.filter((merge) => merge.issue === issue)
		.map((merge) => Date.parse(merge.at))
		.filter((at) => at >= since_ms)

	return instants.length === 0 ? undefined : Math.min(...instants)
}

// The run's end: the last merge of its merged children, `undefined` while none of them is merged.
function end_of(
	records: ReadonlyArray<EstimateEntry>,
	merges: ReadonlyArray<MergeEntry>,
): number | undefined {
	const since_ms = Date.parse(records[0]?.at ?? '')
	const ends = [...new Set(records.map((record) => record.issue))]
		.map((issue) => merged_ms(issue, since_ms, merges))
		.filter(is_number)

	return ends.length === 0 ? undefined : Math.max(...ends)
}

// Actual time left over the expected time left; `undefined` where nothing was expected to be left.
function ratio_of(record: EstimateEntry, end_ms: number): number | undefined {
	const at_ms = Date.parse(record.at)
	const expected_ms = Date.parse(record.finish_at) - at_ms

	return expected_ms > 0 ? (end_ms - at_ms) / expected_ms : undefined
}

function is_within(at_ms: number, window: StatsWindow): boolean {
	return at_ms >= window.since_ms && at_ms <= window.until_ms
}

function run_ratios(
	records: ReadonlyArray<EstimateEntry>,
	merges: ReadonlyArray<MergeEntry>,
	window: StatsWindow,
): RunRatios | undefined {
	const end_ms = end_of(records, merges)

	if (end_ms === undefined || !is_within(end_ms, window)) return undefined

	const ratios = records.map((record) => ratio_of(record, end_ms))
	const [first] = ratios

	return first === undefined ? undefined : { first, all: ratios.filter(is_number) }
}

// The ratios of every run that ended in `window`; `entries` is the whole ledger.
function ratios_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<RunRatios> {
	const merges = entries.filter(is_merge)

	return runs_of(entries.filter(is_estimate))
		.map((records) => run_ratios(records, merges, window))
		.filter((ratios) => ratios !== undefined)
}

const lane_estimate_ratio = { ratios_of }

export type { RunRatios }
export { lane_estimate_ratio }
