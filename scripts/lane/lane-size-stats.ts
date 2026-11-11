import { issue_cite } from '#scripts/issue/issue-cite'
import type { LedgerEntry, SizeEntry } from './lane-ledger-schema'
import { lane_stats, type StatsWindow } from './lane-stats'

// Compare actual non-test changes with the declaration for merged lanes only. A followup retry
// may record size twice; use the latest measurement before each merge (joshuafolkken/kit#5384). A merge
// recorded past the split notice bar counts as a pre-split miss, listed with its declared and actual size
// so the pre-dispatch assessment can be tuned (joshuafolkken/kit#7183).
const COLUMNS = [
	'measured lanes',
	'files actual / declared median',
	'lines actual / declared median',
	'pre-split misses',
]
const MISS_COLUMNS = ['pre-split miss', 'files declared → actual', 'lines declared → actual']
const DECIMALS = 1

interface SizeRatios {
	files?: number | undefined
	lines?: number | undefined
}

function sizes_of(entries: ReadonlyArray<LedgerEntry>): Array<SizeEntry> {
	return entries
		.filter((entry): entry is SizeEntry => entry.kind === 'size')
		.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
}

function merged_sizes(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<SizeEntry> {
	const sizes = sizes_of(entries)

	return lane_stats
		.in_window(entries, window)
		.filter((entry) => entry.kind === 'merge')
		.map((merge) =>
			sizes.findLast(
				(size) => size.issue === merge.issue && Date.parse(size.at) <= Date.parse(merge.at),
			),
		)
		.filter((size): size is SizeEntry => size !== undefined)
}

function ratio_of(sizes: ReadonlyArray<SizeEntry>, axis: 'files' | 'lines'): number | undefined {
	const values = sizes
		.filter((size) => size.declared[axis] > 0)
		.map((size) => size.actual[axis] / size.declared[axis])

	return lane_stats.median(values)
}

function ratio_cell(sizes: ReadonlyArray<SizeEntry>, axis: 'files' | 'lines'): string {
	const median = ratio_of(sizes, axis)

	return median === undefined ? lane_stats.MISSING : median.toFixed(DECIMALS)
}

// The period's `lines actual / declared median`, read by `josh lane:plan` (joshuafolkken/kit#5568).
function lines_ratio(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): number | undefined {
	return ratio_of(merged_sizes(entries, window), 'lines')
}

function ratios(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): SizeRatios {
	const sizes = merged_sizes(entries, window)
	const files = ratio_of(sizes, 'files')
	const lines = ratio_of(sizes, 'lines')

	return { ...(files !== undefined && { files }), ...(lines !== undefined && { lines }) }
}

function header(columns: ReadonlyArray<string>): Array<string> {
	return [lane_stats.to_row(columns), lane_stats.to_row(columns.map(() => '---'))]
}

function change_cell(size: SizeEntry, axis: 'files' | 'lines'): string {
	return `${String(size.declared[axis])} → ${String(size.actual[axis])}`
}

// One row per merged lane recorded past the split notice bar; none prints no table.
function miss_rows(misses: ReadonlyArray<SizeEntry>): Array<string> {
	if (misses.length === 0) return []
	const rows = misses.map((size) =>
		lane_stats.to_row([
			issue_cite.plain_for('terminal', size.issue),
			change_cell(size, 'files'),
			change_cell(size, 'lines'),
		]),
	)

	return ['', ...header(MISS_COLUMNS), ...rows]
}

function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const sizes = merged_sizes(entries, window)
	const misses = sizes.filter((size) => size.missed === true)

	return [
		...header(COLUMNS),
		lane_stats.to_row([
			String(sizes.length),
			ratio_cell(sizes, 'files'),
			ratio_cell(sizes, 'lines'),
			String(misses.length),
		]),
		...miss_rows(misses),
	].join('\n')
}

const lane_size_stats = { lines_ratio, merged_sizes, ratios, table }

export { lane_size_stats }
export type { SizeRatios }
