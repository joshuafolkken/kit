import type { LedgerEntry, SizeEntry } from './lane-ledger-schema'
import { lane_stats, type StatsWindow } from './lane-stats'

// Compare actual non-test changes with the declaration for merged lanes only. A followup retry
// may record size twice; use the latest measurement before each merge (joshuafolkken/kit#5384).
const COLUMNS = [
	'measured lanes',
	'files actual / declared median',
	'lines actual / declared median',
]
const DECIMALS = 1

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
	const ratios = sizes
		.filter((size) => size.declared[axis] > 0)
		.map((size) => size.actual[axis] / size.declared[axis])

	return lane_stats.median(ratios)
}

function ratio_cell(sizes: ReadonlyArray<SizeEntry>, axis: 'files' | 'lines'): string {
	const median = ratio_of(sizes, axis)

	return median === undefined ? lane_stats.MISSING : median.toFixed(DECIMALS)
}

// The period's `lines actual / declared median`, read by `josh lane:plan` (joshuafolkken/kit#5568).
function lines_ratio(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): number | undefined {
	return ratio_of(merged_sizes(entries, window), 'lines')
}

function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const sizes = merged_sizes(entries, window)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		lane_stats.to_row([
			String(sizes.length),
			ratio_cell(sizes, 'files'),
			ratio_cell(sizes, 'lines'),
		]),
	].join('\n')
}

const lane_size_stats = { lines_ratio, table }

export { lane_size_stats }
