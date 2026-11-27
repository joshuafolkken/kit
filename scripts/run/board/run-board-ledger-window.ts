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
// The read starts `MARGIN_DAYS` before the window, so a merge in the window whose lane was dispatched
// shortly before it still finds its dispatch; only a lane running longer than the margin falls back.
//
// A live worker grows the window by the appended lines alone and lets go of the lines that fell out of
// it (joshuafolkken/kit#8206).
//
// Remembered per ledger stamp, so a redraw over an unchanged ledger hands back the same array and the
// readers' own memos aggregate nothing again (joshuafolkken/kit#7012).
//
// The live worker holds only the kinds those readers count — a stage, dispatch, merge, hold, release or declared size
// — and the whole ledger's only while the window leaves a value to fill, in a tail cache of its own
// that grows by the appended lines and is let go once the window covers (joshuafolkken/kit#8034).

const MARGIN_DAYS = 1
const PERIOD_DAYS = Math.max(run_board_usual.PERIOD_DAYS, run_board_lane_totals.PERIOD_DAYS)
// The days the board reads back: the readers' period and the margin before it.
const READ_DAYS = PERIOD_DAYS + MARGIN_DAYS
const { KIND } = lane_ledger
const BOARD_KINDS: ReadonlySet<string> = new Set([
	KIND.STAGE,
	KIND.DISPATCH,
	KIND.MERGE,
	KIND.HELD,
	KIND.RELEASED,
	// The declared sizes the lane totals band by (joshuafolkken/kit#8954).
	KIND.SIZE,
	KIND.DECLARED,
])
const windows = stamped_memo.create<ReadonlyArray<LedgerEntry>>()

function is_board_entry(entry: LedgerEntry): boolean {
	return BOARD_KINDS.has(entry.kind)
}

// joshuafolkken/kit#8206: the window grown by the appended lines alone, not read backward again on each
// append; its start moves on with the clock, so it slides.
const board_windows = lane_ledger.window_store({ is_kept: is_board_entry, slides: true })
const wholes = lane_ledger.tail_store(is_board_entry)

function covers(entries: ReadonlyArray<LedgerEntry>, now_ms: number): boolean {
	return run_board_usual.covers(entries, now_ms) && run_board_lane_totals.covers(entries, now_ms)
}

function read_window(path: string, now_ms: number): ReadonlyArray<LedgerEntry> {
	const { since_ms } = lane_stats.window_of(READ_DAYS, now_ms)
	const entries = board_windows.read(path, since_ms)

	if (!covers(entries, now_ms)) return wholes.read(path)

	wholes.forget(path)

	return entries
}

// An absent or unreadable ledger is never remembered, so it reads again once it appears.
function entries_of(path: string, now_ms: number): ReadonlyArray<LedgerEntry> {
	const stamp = stamped_memo.file_stamp(path)

	if (stamp === stamped_memo.NO_STAMP) return read_window(path, now_ms)

	return windows.of(path, stamp, () => read_window(path, now_ms))
}

const run_board_ledger_window = { READ_DAYS, entries_of }

export { run_board_ledger_window }
