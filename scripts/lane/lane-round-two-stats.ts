import { lane_ledger, type LedgerEntry, type RoundTwoEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'

// Why round 2 ran or was skipped: the ledger's `round-two` entries of one period reduced to one row per
// verdict and reason code, printed by `josh lane:stats` so the next change — to the procedure, or to
// what counts as an inert fix — is chosen from counts rather than impressions (joshuafolkken/kit#4064).

const COLUMNS = ['round 2', 'code', 'decisions'] as const
const KEY_SEPARATOR = ' '
// A period with no decision: the table still prints, so a reader sees zero rather than no table.
const NONE_ROW = ['none', 'none', '0']

function is_round_two(entry: LedgerEntry): entry is RoundTwoEntry {
	return entry.kind === lane_ledger.KIND.ROUND_TWO
}

function counts_of(decisions: ReadonlyArray<RoundTwoEntry>): Map<string, number> {
	const counts = new Map<string, number>()

	for (const decision of decisions) {
		const key = `${decision.verdict}${KEY_SEPARATOR}${decision.code}`

		counts.set(key, (counts.get(key) ?? 0) + 1)
	}

	return counts
}

// The most frequent pair first, so the reason worth acting on leads.
function rows_of(counts: ReadonlyMap<string, number>): Array<string> {
	return [...counts]
		.toSorted(([, left], [, right]) => right - left)
		.map(([key, count]) => lane_stats.to_row([...key.split(KEY_SEPARATOR), String(count)]))
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const rows = rows_of(counts_of(lane_stats.in_window(entries, window).filter(is_round_two)))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...(rows.length === 0 ? [lane_stats.to_row(NONE_ROW)] : rows),
	].join('\n')
}

const lane_round_two_stats = { table }

export { lane_round_two_stats }
