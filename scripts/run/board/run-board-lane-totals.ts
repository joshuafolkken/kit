import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_kind } from '#scripts/lane/lane-ledger-kind'
import { lane_stage_stats } from '#scripts/lane/lane-stage-stats'
import { lane_stats, type MergedLane } from '#scripts/lane/lane-stats'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// How long a lane takes from its dispatch to its merge, as the lane ledger measured it
// (`lane_stats.merge_minutes`, the `lane median` of `lane:stats`; joshuafolkken/kit#7770). The run
// board's estimated finish reads these totals rather than summing each phase's usual time once, so a
// ship retried and the waits between phases count as they did. As with the usual times
// (`run-board-usual.ts`), only the last `PERIOD_DAYS` count, and an empty window falls back to the
// whole ledger.
//
// The totals are also banded by the lines an Issue declared (joshuafolkken/kit#8954; joshuafolkken/kit#8947
// measured a large Issue's lane 29% over the median, a small one's 17% under): a past lane's band from
// its `size` record, a running or waiting row's from the `declared` record `lane:plan` writes, the
// latest of either counting. A row reads its band's totals through `totals_for`, the whole totals where
// its band has fewer than `MIN_BAND_LANES` lanes or the ledger carries no declared size for it — the
// undeclared lanes are resumes and small fixes, so they make no band of their own. Only the small and
// large bands narrow: replayed over the 28 days to 2026-11-27, the medium band's median missed by more
// than the whole median did (10.6′ against 10.4′), so a medium row reads the whole totals.

const { KIND } = lane_ledger_kind

type LaneTotals = ReadonlyArray<number>
type Band = 'small' | 'medium' | 'large'
const NARROWED_BANDS: ReadonlyArray<Band> = ['small', 'large']

interface LaneBands {
	totals: ReadonlyMap<Band, LaneTotals>
	// Each issue's band, from the latest declared size the ledger carries for it.
	of_issue: ReadonlyMap<number, Band>
}

const PERIOD_DAYS = 3
// The bands' upper bounds in declared lines, as joshuafolkken/kit#8947 cut them.
const SMALL_LINES = 40
const MEDIUM_LINES = 100
// The fewest lanes a band's median stands on, as joshuafolkken/kit#8947 judged a band.
const MIN_BAND_LANES = 5
const NO_BANDS: LaneBands = { totals: new Map(), of_issue: new Map() }

function recent_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): Array<LedgerEntry> {
	return lane_stats.in_window(entries, lane_stats.window_of(PERIOD_DAYS, now_ms))
}

function lanes_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): Array<MergedLane> {
	const recent = lane_stats.merged_lanes(entries, recent_of(entries, now_ms))

	return recent.length > 0 ? recent : lane_stats.merged_lanes(entries, entries)
}

function ms_of(lanes: ReadonlyArray<MergedLane>): LaneTotals {
	return lanes.map((lane) => lane.minutes * MS_PER_MINUTE)
}

function band_of(lines: number): Band {
	if (lines <= SMALL_LINES) return 'small'

	return lines <= MEDIUM_LINES ? 'medium' : 'large'
}

interface Declared {
	issue: number
	lines: number
}

// The declared lines of a `size` or `declared` record, `undefined` for any other entry.
function declared_of(entry: LedgerEntry): Declared | undefined {
	if (entry.kind === KIND.SIZE) return { issue: entry.issue, lines: entry.declared.lines }

	return entry.kind === KIND.DECLARED ? { issue: entry.issue, lines: entry.lines } : undefined
}

// Each issue's band, a later record replacing an earlier one — the ledger is appended in time order.
function issue_bands(entries: ReadonlyArray<LedgerEntry>): Map<number, Band> {
	const declared = entries.map((entry) => declared_of(entry)).filter((entry) => entry !== undefined)

	return new Map(declared.map((entry) => [entry.issue, band_of(entry.lines)]))
}

function compute_bands(entries: ReadonlyArray<LedgerEntry>, now_ms: number): LaneBands {
	const of_issue = issue_bands(entries)
	const lanes = lanes_of(entries, now_ms)
	const totals = new Map<Band, LaneTotals>(
		NARROWED_BANDS.map((band) => [
			band,
			ms_of(lanes.filter((lane) => of_issue.get(lane.issue) === band)),
		]),
	)

	return { totals, of_issue }
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
const bands_memo = new WeakMap<ReadonlyArray<LedgerEntry>, LaneBands>()

function memoized<T>(
	memo: WeakMap<ReadonlyArray<LedgerEntry>, T>,
	entries: ReadonlyArray<LedgerEntry>,
	compute: () => T,
): T {
	const known = memo.get(entries)

	if (known !== undefined) return known
	const value = compute()

	memo.set(entries, value)

	return value
}

function totals_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): LaneTotals {
	return memoized(totals_memo, entries, () => ms_of(lanes_of(entries, now_ms)))
}

function bands_of(entries: ReadonlyArray<LedgerEntry>, now_ms: number): LaneBands {
	return memoized(bands_memo, entries, () => compute_bands(entries, now_ms))
}

// The totals `issue`'s finish reads: its band's, or the whole totals where it has no band or its band
// too few lanes. The one place a row's band narrows the totals.
function totals_for(totals: LaneTotals, bands: LaneBands | undefined, issue: number): LaneTotals {
	const { of_issue, totals: banded } = bands ?? NO_BANDS
	const band = of_issue.get(issue)
	const narrowed = band === undefined ? undefined : banded.get(band)

	return narrowed !== undefined && narrowed.length >= MIN_BAND_LANES ? narrowed : totals
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

const run_board_lane_totals = {
	MIN_BAND_LANES,
	PERIOD_DAYS,
	bands_of,
	covers,
	running_left_ms,
	totals_for,
	totals_of,
	waiting_ms,
}

export { run_board_lane_totals }
export type { Band, LaneBands, LaneTotals }
