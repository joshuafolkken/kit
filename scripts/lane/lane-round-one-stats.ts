import { lane_ledger, type LedgerEntry, type RoundOneEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'

// How a `josh ship`'s round 1 ended: the ledger's `round-one` entries of one period, one row per
// verdict, with each reviewed verdict's share of the rounds the ship ran. The `clean` share is the rate
// a ship-time round 1 passed with no fix — the number the "CI beside the review" break-even of
// `docs/maintainers/lane-limit-measurement.md` is read against (joshuafolkken/kit#4620). A `reused`
// round never ran, so it has a count and no share.

const COLUMNS = ['round 1', 'rounds', 'share'] as const
const VERDICTS = ['clean', 'fixed', 'blocking'] as const
const REUSED = 'reused'
const NO_SHARE = '-'
const PERCENT = 100

function is_round_one(entry: LedgerEntry): entry is RoundOneEntry {
	return entry.kind === lane_ledger.KIND.ROUND_ONE
}

function count_of(rounds: ReadonlyArray<RoundOneEntry>, verdict: string): number {
	return rounds.filter((round) => round.verdict === verdict).length
}

function share_of(count: number, ran: number): string {
	if (ran === 0) return NO_SHARE

	return `${String(Math.round((count * PERCENT) / ran))}%`
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const rounds = lane_stats.in_window(entries, window).filter(is_round_one)
	const counts = VERDICTS.map((verdict) => count_of(rounds, verdict))
	const ran = counts.reduce((sum, count) => sum + count, 0)
	const rows = VERDICTS.map((verdict, index) => {
		const count = counts[index] ?? 0

		return lane_stats.to_row([verdict, String(count), share_of(count, ran)])
	})

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...rows,
		lane_stats.to_row([REUSED, String(count_of(rounds, REUSED)), NO_SHARE]),
	].join('\n')
}

const lane_round_one_stats = { REUSED, table }

export { lane_round_one_stats }
