import { split_resolution } from '#scripts/split/split-resolution'
import type { LedgerEntry, SplitNoticeEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'

// Whether the split notice works: the lanes the notice reached in one period, and how many of them
// filed a split child, printed by `josh lane:stats` so the notice's effect is read off the ledger
// rather than searched for in lane transcripts (joshuafolkken/kit#4695). A split child counts
// whenever it was filed, since a lane may carve the rest out before the notice reaches it.
//
// **One row per reason under the `all` row** (joshuafolkken/kit#5568): the axis `josh lane:plan`
// answered `split` on, or `diff` for the measured-diff notice, which carries none. A lane noticed on
// two axes counts once in `all` and once under each.

const COLUMNS = ['reason', 'noticed lanes', 'split'] as const
const REASONS = ['files', 'hunks', 'lines', 'diff'] as const
const ALL = 'all'

function reason_of(entry: SplitNoticeEntry): string {
	return entry.reason ?? 'diff'
}

function row_of(label: string, noticed: ReadonlySet<number>, split: ReadonlySet<number>): string {
	const split_count = [...noticed].filter((issue) => split.has(issue)).length

	return lane_stats.to_row([label, String(noticed.size), String(split_count)])
}

function issues_of(notices: ReadonlyArray<SplitNoticeEntry>, reason: string): Set<number> {
	return new Set(
		notices
			.filter((entry) => reason === ALL || reason_of(entry) === reason)
			.map(({ issue }) => issue),
	)
}

// The period's table: `entries` is the whole ledger; the notices are filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const in_period = split_resolution.notices(lane_stats.in_window(entries, window))
	const split = split_resolution.split_issues(entries)
	const rows = [ALL, ...REASONS].map((reason) =>
		row_of(reason, issues_of(in_period, reason), split),
	)

	return [lane_stats.to_row(COLUMNS), lane_stats.to_row(COLUMNS.map(() => '---')), ...rows].join(
		'\n',
	)
}

const lane_split_stats = { table }

export { lane_split_stats }
