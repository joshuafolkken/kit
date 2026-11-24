import type { LedgerEntry } from './lane-ledger'
import type { DispatchEntry } from './lane-ledger-schema-dispatch'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// Which model the period's lanes ran on and why (joshuafolkken/kit#8815): one row per implement model
// and the reason the dispatch recorded for it, with the lanes dispatched on it and how many of them
// merged, printed by `josh lane:stats`. A dispatch row without a model (written before it was recorded,
// or by a foreground `josh run` entry) counts under `unrecorded`. A lane dispatched again on the same
// model counts once, under its first dispatch's reason: a routed lane's resume reads back the worker
// label the route stored (joshuafolkken/kit#8760) and would otherwise count again under `label`.

const COLUMNS = ['model', 'reason', 'dispatched lanes', 'merged'] as const
const UNRECORDED = 'unrecorded'
const KEY_SEPARATOR = '\0'

function key_of(entry: DispatchEntry): string {
	return [entry.model ?? UNRECORDED, entry.reason ?? UNRECORDED].join(KEY_SEPARATOR)
}

function first_per_lane(dispatches: ReadonlyArray<DispatchEntry>): Array<DispatchEntry> {
	const firsts = new Map<string, DispatchEntry>()

	for (const entry of dispatches) {
		const lane = [entry.issue, entry.model ?? UNRECORDED].join(KEY_SEPARATOR)

		if (!firsts.has(lane)) firsts.set(lane, entry)
	}

	return [...firsts.values()]
}

function group(dispatches: ReadonlyArray<DispatchEntry>): Map<string, Set<number>> {
	const groups = new Map<string, Set<number>>()

	for (const entry of dispatches) {
		const key = key_of(entry)

		groups.set(key, (groups.get(key) ?? new Set<number>()).add(entry.issue))
	}

	return groups
}

function row_of(key: string, issues: ReadonlySet<number>, merged: ReadonlySet<number>): string {
	const merged_count = [...issues].filter((issue) => merged.has(issue)).length

	return lane_stats.to_row([...key.split(KEY_SEPARATOR), String(issues.size), String(merged_count)])
}

// The period's table: `entries` is the whole ledger; the dispatches are filtered here to `window`,
// while a merge counts whenever it landed.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const dispatches = lane_stats
		.in_window(entries, window)
		.filter((entry) => lane_stage_stats.is_dispatch(entry))
	const merges = entries.filter((entry) => lane_stage_stats.is_merge(entry))
	const merged = new Set(merges.map(({ issue }) => issue))
	const groups = [...group(first_per_lane(dispatches))].toSorted(([left], [right]) =>
		left.localeCompare(right),
	)
	const rows = groups.map(([key, issues]) => row_of(key, issues, merged))

	return [lane_stats.to_row(COLUMNS), lane_stats.to_row(COLUMNS.map(() => '---')), ...rows].join(
		'\n',
	)
}

const lane_model_stats = { table }

export { lane_model_stats }
