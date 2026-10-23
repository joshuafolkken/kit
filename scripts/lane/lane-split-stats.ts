import { split_resolution } from '#scripts/split/split-resolution'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'

// Whether the split notice works: the lanes the notice reached in one period, and how many of them
// filed a split child, printed by `josh lane:stats` so the notice's effect is read off the ledger
// rather than searched for in lane transcripts (joshuafolkken/kit#4695). A split child counts
// whenever it was filed, since a lane may carve the rest out before the notice reaches it.

const COLUMNS = ['noticed lanes', 'split'] as const

// The period's table: `entries` is the whole ledger; the notices are filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const in_period = split_resolution.notices(lane_stats.in_window(entries, window))
	const noticed = new Set(in_period.map((entry) => entry.issue))
	const split = split_resolution.split_issues(entries)
	const split_count = [...noticed].filter((issue) => split.has(issue)).length

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		lane_stats.to_row([String(noticed.size), String(split_count)]),
	].join('\n')
}

const lane_split_stats = { table }

export { lane_split_stats }
