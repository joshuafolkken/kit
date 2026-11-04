import type { LedgerEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'

const COLUMNS = ['early push', 'result', 'decisions']

function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const counts = new Map<string, number>()

	for (const entry of lane_stats.in_window(entries, window)) {
		if (entry.kind !== 'early-push') continue
		const key = lane_stats.to_row([entry.source, entry.result])

		counts.set(key, (counts.get(key) ?? 0) + 1)
	}

	const rows = [...counts].map(([key, count]) => `${key} ${String(count)} |`)

	return [lane_stats.to_row(COLUMNS), lane_stats.to_row(COLUMNS.map(() => '---')), ...rows].join(
		'\n',
	)
}

const lane_early_push_stats = { table }

export { lane_early_push_stats }
