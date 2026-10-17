import { lane_ledger, type HeldEntry, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long a free lane stayed empty, and why: the ledger's `held` entries of one period reduced to one
// row per reason, printed by `josh lane:stats` so the idle capacity a `backlog:stalled` episode reported
// is split by cause — an offer that started nothing apart from a driver waiting on its session
// (joshuafolkken/kit#3995).
//
// **A hold lasts until the next `held`, `released` or `dispatch` entry**: the driver writes one on every
// offered pass that started nothing, so consecutive entries tile the wait and the last one ends at the
// dispatch — or at the release a full pool or a finished run writes.
// A hold nothing followed is counted under `not ended`, kept out of the minutes, whose time has no end;
// one past `MAX_HOLD_MS` is a driver nobody restarted, read as ended at the cap.

const COLUMNS = [
	'held by',
	'total (min)',
	'median (min)',
	'max (min)',
	'holds',
	'not ended',
] as const
const MS_PER_HOUR = 3_600_000
const MAX_HOLD_MS = MS_PER_HOUR
const { NOT_MEASURED } = lane_stage_stats
// A period with no hold: the table still prints, so a reader sees zero holds rather than no table.
const NONE_ROW = ['none', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, '0', '0']
const { is_dispatch, is_number } = lane_stage_stats

interface Hold {
	reason: string
	wait_ms: number | undefined
}

function is_held(entry: LedgerEntry): entry is HeldEntry {
	return entry.kind === lane_ledger.KIND.HELD
}

function is_hold_end(entry: LedgerEntry): boolean {
	return is_held(entry) || is_dispatch(entry) || entry.kind === lane_ledger.KIND.RELEASED
}

// Every instant a hold can end at, parsed and sorted once: holds come once a minute, so re-reading the
// whole ledger per hold made a week's `lane:stats` take seconds.
function end_times(entries: ReadonlyArray<LedgerEntry>): Array<number> {
	return entries
		.filter((entry) => is_hold_end(entry))
		.map((entry) => Date.parse(entry.at))
		.filter((at) => Number.isFinite(at))
		.toSorted((left, right) => left - right)
}

function wait_ms(held: HeldEntry, ends: ReadonlyArray<number>): number | undefined {
	const from_ms = Date.parse(held.at)
	const end_ms = ends.find((at) => at > from_ms)

	return end_ms === undefined ? undefined : Math.min(end_ms - from_ms, MAX_HOLD_MS)
}

function holds_of(entries: ReadonlyArray<LedgerEntry>): Array<Hold> {
	const ends = end_times(entries)

	return entries
		.filter(is_held)
		.map((held) => ({ reason: held.reason, wait_ms: wait_ms(held, ends) }))
}

function total(values: ReadonlyArray<number>): number {
	return values.reduce((sum, value) => sum + value, 0)
}

function ended_of(holds: ReadonlyArray<Hold>, reason: string): Array<number> {
	return holds
		.filter((hold) => hold.reason === reason)
		.map((hold) => hold.wait_ms)
		.filter((value) => is_number(value))
}

function reason_row(reason: string, holds: ReadonlyArray<Hold>): string {
	const ended = ended_of(holds, reason)
	const count = holds.filter((hold) => hold.reason === reason).length

	return lane_stats.to_row([
		reason,
		lane_stage_stats.cell(ended.length === 0 ? undefined : total(ended)),
		lane_stage_stats.cell(lane_stats.median(ended)),
		lane_stage_stats.cell(lane_stats.peak(ended)),
		String(count),
		String(count - ended.length),
	])
}

// The reasons the period saw, the longest total first, so the cause worth removing next leads.
function reasons_of(holds: ReadonlyArray<Hold>): Array<string> {
	const reasons = [...new Set(holds.map((hold) => hold.reason))]

	return reasons.toSorted(
		(left, right) => total(ended_of(holds, right)) - total(ended_of(holds, left)),
	)
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const holds = holds_of(lane_stats.in_window(entries, window))
	const rows = reasons_of(holds).map((reason) => reason_row(reason, holds))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...(rows.length === 0 ? [lane_stats.to_row(NONE_ROW)] : rows),
	].join('\n')
}

const lane_held_stats = { table }

export { lane_held_stats }
