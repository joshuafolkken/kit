import { lane_ledger_kind } from './lane-ledger-kind'
import type { LedgerEntry, LimitEntry } from './lane-ledger-schema'
import { lane_stats, type StatsWindow } from './lane-stats'

// The period split by the lane limit each entry was written under: one `lane:stats` row per limit, so
// the limit with the most merges per active hour is read from the ledger rather than guessed
// (joshuafolkken/kit#8762). An entry's limit is the last `limit` line at or before it; an entry before
// any `limit` line belongs to no limit. Dispatches stay in every slice — a lane's time is measured
// from its dispatch, which may fall under another limit than its merge.

const { KIND } = lane_ledger_kind
// A limit held for less active time than this is too short a sample to pick: one quick merge in a
// few minutes would read as the best rate.
const MIN_ACTIVE_HOURS = 4
const HALF = 2

interface LimitSlice {
	limit: number
	entries: ReadonlyArray<LedgerEntry>
}

interface LimitChange {
	at_ms: number
	limit: number
}

function is_limit(entry: LedgerEntry): entry is LimitEntry {
	return entry.kind === KIND.LIMIT
}

// The `limit` lines as instants, oldest first, so each lookup is a binary search: a 14-day ledger
// holds far too many entries for a scan of every `limit` line per entry.
function timeline_of(entries: ReadonlyArray<LedgerEntry>): Array<LimitChange> {
	return entries
		.filter((entry) => is_limit(entry))
		.map((entry) => ({ at_ms: Date.parse(entry.at), limit: entry.limit }))
		.toSorted((left, right) => left.at_ms - right.at_ms)
}

// How many changes fall at or before `at_ms`.
function changes_up_to(timeline: ReadonlyArray<LimitChange>, at_ms: number): number {
	let low = 0
	let high = timeline.length

	while (low < high) {
		const middle = Math.floor((low + high) / HALF)

		if ((timeline[middle]?.at_ms ?? Infinity) <= at_ms) low = middle + 1
		else high = middle
	}

	return low
}

// The limit in force at `at_ms` — the last change at or before it — `undefined` before the first.
function limit_at(timeline: ReadonlyArray<LimitChange>, at_ms: number): number | undefined {
	return timeline[changes_up_to(timeline, at_ms) - 1]?.limit
}

function slice_of(
	entries: ReadonlyArray<LedgerEntry>,
	held: ReadonlyArray<number | undefined>,
	limit: number,
): LimitSlice {
	const kept = entries.filter(
		(entry, index) => entry.kind === KIND.DISPATCH || held[index] === limit,
	)

	return { limit, entries: kept }
}

// One slice per limit the window's entries were written under, lowest limit first.
function slices_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<LimitSlice> {
	const timeline = timeline_of(entries)
	const held = entries.map((entry) => limit_at(timeline, Date.parse(entry.at)))
	const in_window = lane_stats
		.in_window(entries, window)
		.map((entry) => limit_at(timeline, Date.parse(entry.at)))
		.filter((limit) => limit !== undefined)

	return [...new Set(in_window)]
		.toSorted((left, right) => left - right)
		.map((limit) => slice_of(entries, held, limit))
}

function rate_of(slice: LimitSlice, window: StatsWindow): number | undefined {
	const period = lane_stats.in_window(slice.entries, window)
	const hours = lane_stats.active_hours(period)

	return hours !== undefined && hours >= MIN_ACTIVE_HOURS
		? lane_stats.merges_per_hour(period)
		: undefined
}

interface LimitRate {
	limit: number
	rate: number
}

// The limit with the most merges per active hour among those held long enough; a tie keeps the
// lower limit, which reaches the same throughput with less load — slices arrive lowest limit first and
// the sort is stable. `undefined` when none qualifies.
function best_limit(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): number | undefined {
	const rated = slices_of(entries, window)
		.map((slice) => ({ limit: slice.limit, rate: rate_of(slice, window) }))
		.filter((entry): entry is LimitRate => entry.rate !== undefined)
	const [best] = rated.toSorted((left, right) => right.rate - left.rate)

	return best?.limit
}

function best_line(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const best = best_limit(entries, window)
	const text = best === undefined ? lane_stats.MISSING : String(best)

	return `Most merges per active hour (limits with ≥ ${String(MIN_ACTIVE_HOURS)} active hours): ${text}`
}

// The per-limit table printed under the period's row.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const rows = slices_of(entries, window).map((slice) =>
		lane_stats.row(slice.entries, window, { limit: String(slice.limit) }),
	)

	return ['By lane limit', lane_stats.header(), ...rows, '', best_line(entries, window)].join('\n')
}

const lane_limit_table = { best_limit, limit_at, slices_of, table, timeline_of }

export { lane_limit_table }
