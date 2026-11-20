import { backlog_hold_codes } from '#scripts/backlog/backlog-hold-codes'
import { backlog_wait_cause } from '#scripts/backlog/backlog-wait-cause'
import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_ledger, type HeldEntry, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long a free lane stayed empty, and why: the ledger's `held` entries of one period reduced to one
// row per reason, printed by `josh lane:stats` so the idle capacity a backlog stall episode reported
// is split by cause — an offer that started nothing apart from a driver waiting on its session
// (joshuafolkken/kit#3995).
//
// **A hold lasts until the next `held`, `released` or `dispatch` entry**: the driver writes one on every
// offered pass that started nothing, so consecutive entries tile the wait and the last one ends at the
// dispatch — or at the release a full pool or a finished run writes.
// A hold nothing followed is counted under `not ended`, kept out of the minutes, whose time has no end;
// one past `MAX_HOLD_MS` is a driver nobody restarted, read as ended at the cap.
//
// Two more tables read the same holds (joshuafolkken/kit#8331): `held by cause` splits a watch offer's
// `chain+gate` tag into its causes, and `held behind` sums the issues the hold named under `waiting`.
// **A hold with several causes or issues counts in full under each**, so those rows overlap and sum past
// the free-lane time; the header says so.

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
const LAUNCH_COMMAND = 'lane:launch'
const { NOT_MEASURED } = lane_stage_stats
// A period with no hold: the table still prints, so a reader sees zero holds rather than no table.
const NONE_ROW = ['none', NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, '0', '0']
const { is_dispatch, is_number } = lane_stage_stats
const { OFFER_PREFIX, REASON_SEPARATOR, WATCH_VERDICT } = backlog_hold_codes
const WATCH_PREFIX = `${OFFER_PREFIX}${REASON_SEPARATOR}${WATCH_VERDICT}${REASON_SEPARATOR}`
const CAUSE_HEADER = 'held by cause (a hold with several causes counts in full under each)'
const BLOCKER_HEADER =
	'held behind (chain + gate; a hold naming several issues counts in full under each)'
// The blocking issues printed, the longest total first: the ones worth unblocking next.
const BLOCKER_ROWS = 10

interface Hold {
	reason: string
	wait_ms: number | undefined
	waiting: ReadonlyArray<number>
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

	return entries.filter(is_held).map((held) => ({
		reason: held.reason,
		wait_ms: wait_ms(held, ends),
		waiting: held.waiting ?? [],
	}))
}

// Launch admission already writes its exact wait to the shared ledger; do not infer it from
// unrelated driver events, which may happen while another lane is still waiting to launch.
function launch_holds(entries: ReadonlyArray<LedgerEntry>): Array<Hold> {
	return entries.flatMap((entry) =>
		entry.kind === lane_ledger.KIND.CORE_WAIT && entry.command === LAUNCH_COMMAND
			? { reason: LAUNCH_COMMAND, wait_ms: entry.waited_ms, waiting: [] }
			: [],
	)
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

function period_holds(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<Hold> {
	const period = lane_stats.in_window(entries, window)

	return [...holds_of(period), ...launch_holds(period)]
}

// One row per distinct `reason` of `holds` under the `header` column, the first `limit` rows only.
function render(header: string, holds: ReadonlyArray<Hold>, limit = Infinity): string {
	const columns = [header, ...COLUMNS.slice(1)]
	const rows = reasons_of(holds)
		.slice(0, limit)
		.map((reason) => reason_row(reason, holds))

	return [
		lane_stats.to_row(columns),
		lane_stats.to_row(columns.map(() => '---')),
		...(rows.length === 0 ? [lane_stats.to_row(NONE_ROW)] : rows),
	].join('\n')
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	return render(COLUMNS[0], period_holds(entries, window))
}

// A watch offer's causes (`offer:watch:chain+gate` → chain, gate); none for any other reason.
function causes_of(reason: string): ReadonlyArray<string> {
	if (!reason.startsWith(WATCH_PREFIX)) return []

	return backlog_wait_cause.causes_of_tag(reason.slice(WATCH_PREFIX.length)) ?? []
}

// The period's holds by cause, a hold of several causes counted in full under each.
function cause_table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const holds = period_holds(entries, window).flatMap((hold) =>
		causes_of(hold.reason).map((cause) => ({ ...hold, reason: cause })),
	)

	return render(CAUSE_HEADER, holds)
}

// The period's holds by the issue they waited on, the longest total first.
function blocker_table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const holds = period_holds(entries, window).flatMap((hold) =>
		hold.waiting.map((issue) => ({ ...hold, reason: issue_cite.plain_for('terminal', issue) })),
	)

	return render(BLOCKER_HEADER, holds, BLOCKER_ROWS)
}

function is_open_at(held: HeldEntry, now_ms: number): boolean {
	return now_ms - Date.parse(held.at) < MAX_HOLD_MS
}

// The reason of the hold still open at the ledger's end, or `undefined` where the last one has ended —
// or is past `MAX_HOLD_MS`, a driver killed while held that wrote no hand-back.
function open_reason(entries: ReadonlyArray<LedgerEntry>, now_ms: number): string | undefined {
	const last = entries.findLast((entry) => is_hold_end(entry))

	return last !== undefined && is_held(last) && is_open_at(last, now_ms) ? last.reason : undefined
}

const lane_held_stats = { blocker_table, cause_table, open_reason, table }

export { lane_held_stats }
