import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stage_stats } from '#scripts/lane/lane-stage-stats'
import { lane_stats } from '#scripts/lane/lane-stats'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// How long a lane takes from its dispatch to its merge, as the lane ledger measured it
// (`lane_stats.merge_minutes`, the `lane median` of `lane:stats`; joshuafolkken/kit#7770). The run
// board's estimated finish reads these totals rather than summing each phase's usual time once, so a
// ship retried and the waits between phases count as they did. As with the usual times
// (`run-board-usual.ts`), only the last `PERIOD_DAYS` count, and an empty window falls back to the
// whole ledger.

type LaneTotals = ReadonlyArray<number>

const PERIOD_DAYS = 3

function recent_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): Array<LedgerEntry> {
	return lane_stats.in_window(entries, lane_stats.window_of(PERIOD_DAYS, now_ms))
}

function compute_totals(entries: ReadonlyArray<LedgerEntry>, now_ms: number): LaneTotals {
	const recent = lane_stats.merge_minutes(entries, recent_of(entries, now_ms))
	const minutes = recent.length > 0 ? recent : lane_stats.merge_minutes(entries, entries)

	return minutes.map((minute) => minute * MS_PER_MINUTE)
}

// Whether `entries`, read from at or before the window's start, give the whole ledger's totals
// (joshuafolkken/kit#7932): the window has a merge, and each one's dispatch is found in them — a merge
// dispatched before the read's start would need the older lines. A lane's dispatch is its latest one by
// time, so one found in the read is the one the whole ledger would find.
function covers(entries: ReadonlyArray<LedgerEntry>, now_ms: number): boolean {
	const merges = recent_of(entries, now_ms).filter((entry) => lane_stage_stats.is_merge(entry))

	return merges.length > 0 && lane_stats.merge_minutes(entries, merges).length === merges.length
}

// Memoized per ledger array, as `run_board_usual.usual_of` is (joshuafolkken/kit#7012).
const totals_memo = new WeakMap<ReadonlyArray<LedgerEntry>, LaneTotals>()

function totals_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): LaneTotals {
	const known = totals_memo.get(entries)

	if (known !== undefined) return known

	const totals = compute_totals(entries, now_ms)

	totals_memo.set(entries, totals)

	return totals
}

// One waiting child's time: the median total, `undefined` with none measured.
function waiting_ms(totals: LaneTotals): number | undefined {
	return lane_stats.median(totals)
}

// What a child `elapsed_ms` into its lane has left: the median of what the lanes that ran longer took
// beyond it. `undefined` where every measured lane ended sooner.
function running_left_ms(totals: LaneTotals, elapsed_ms: number): number | undefined {
	const longer = totals.filter((total) => total > elapsed_ms)

	return lane_stats.median(longer.map((total) => total - elapsed_ms))
}

const run_board_lane_totals = { PERIOD_DAYS, covers, running_left_ms, totals_of, waiting_ms }

export { run_board_lane_totals }
export type { LaneTotals }
