import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stats } from '#scripts/lane/lane-stats'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_board_lane_totals } from './run-board-lane-totals'
import { run_board_usual } from './run-board-usual'

// The lane ledger as the board reads it: only the lines since the usual times' and the lane totals'
// window, read backward from the end, so a fresh process skips the older lines (joshuafolkken/kit#7932)
// — the whole ledger only where the window leaves a stage unmeasured or a merge without its dispatch,
// the lines the whole-ledger fallbacks of `run-board-usual.ts` and `run-board-lane-totals.ts` read. The
// driver's open hold needs no fallback: it ends within the hour, so a hold-end line older than the
// window is never open (`lane_held_stats.open_reason`).
//
// Remembered per ledger stamp, so a redraw over an unchanged ledger hands back the same array and the
// readers' own memos aggregate nothing again (joshuafolkken/kit#7012).

const PERIOD_DAYS = Math.max(run_board_usual.PERIOD_DAYS, run_board_lane_totals.PERIOD_DAYS)
const windows = stamped_memo.create<ReadonlyArray<LedgerEntry>>()

function covers(entries: ReadonlyArray<LedgerEntry>, now_ms: number): boolean {
	return run_board_usual.covers(entries, now_ms) && run_board_lane_totals.covers(entries, now_ms)
}

function read_window(path: string, now_ms: number): ReadonlyArray<LedgerEntry> {
	const { since_ms } = lane_stats.window_of(PERIOD_DAYS, now_ms)
	const { entries } = lane_ledger.read_since(path, since_ms)

	return covers(entries, now_ms) ? entries : lane_ledger.read_entries(path)
}

// An absent or unreadable ledger is never remembered, so it reads again once it appears.
function entries_of(path: string, now_ms: number): ReadonlyArray<LedgerEntry> {
	const stamp = stamped_memo.file_stamp(path)

	if (stamp === stamped_memo.NO_STAMP) return read_window(path, now_ms)

	return windows.of(path, stamp, () => read_window(path, now_ms))
}

const run_board_ledger_window = { entries_of }

export { run_board_ledger_window }
