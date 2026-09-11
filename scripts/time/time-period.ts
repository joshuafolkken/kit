import { time_contributors } from './time-contributors'
import type { LabeledDistribution } from './time-distribution'
import { time_history, type RunTimeRecord } from './time-history'
import { time_instant } from './time-instant'
import { time_lanes, type Lane, type LaneRun, type SerialInterval } from './time-lanes'
import type { Interval } from './time-overlap'

// A period as the unit of a report, instead of one run (joshuafolkken/kit#1470).
//
// **The source is the accumulation joshuafolkken/kit#1471 already started**, `.time-history.jsonl`,
// read through `time_history` and nothing else. A second reader of the transcripts would be a second
// classification, which is exactly what makes two runs incomparable — so this module does no
// measuring of its own: it groups records that were already measured.
//
// **A record with no wall-clock window is excluded and counted, never defaulted.** The field pair
// was added by this change, so every record written before it carries none, and placing such a run
// at the epoch would invent a lane that ran for fifty-six years. An unknown is withheld and said out
// loud in `notes`, the rule the run scope already follows for an unmeasured phase.

const NONE = 0
const ONE = 1
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const DATE_END = 10
const EMPTY_SPAN: Interval = { started_ms: NONE, ended_ms: NONE }
const SINGLE_LANE_NOTE =
	'One lane only: no two runs overlapped in this window, so every wait was exposed and no stretch could be serialized behind another lane.'

type RecordReader = (root: string) => Array<RunTimeRecord>

interface LaneTotals {
	index: number
	run_count: number
	busy_ms: number
	idle_ms: number
	issues: Array<number>
}

interface DayTotals {
	date: string
	run_count: number
	elapsed_ms: number
}

interface PeriodWindow {
	scope: string
	period_days: number
	started_at: string
	ended_at: string
	span_ms: number
	run_count: number
	undated_count: number
}

interface PeriodThroughput {
	lane_count: number
	lanes: Array<LaneTotals>
	busy_ms: number
	runs_per_hour: number
	// Busy wall clock over the window's wall clock: how many lanes' worth of work the period actually
	// got done, against how many lanes it had. It is the one figure that says whether adding a lane
	// bought anything.
	effective_lanes: number
}

interface PeriodContention {
	serialization: Array<SerialInterval>
	serialized_ms: number
	hidden_ms: number
	exposed_ms: number
	by_day: Array<DayTotals>
}

interface PeriodTimeReport extends PeriodWindow, PeriodThroughput, PeriodContention {
	// What the period's runs spent their turns on, aggregated exactly as `--last` aggregates it
	// (joshuafolkken/kit#1763) — the same module builds both, so the two scopes cannot come to answer
	// the question differently. Records written before the breakdown was stored carry none and are
	// excluded from each row's sample count, the rule an undated record already follows.
	contributors: Array<LabeledDistribution>
	notes: Array<string>
}

interface PeriodInput {
	period_days: number
	runs: ReadonlyArray<LaneRun>
	// The same runs as `runs`, still as records — the lane types carry a window and nothing else, and
	// the turn breakdown lives on the record. Kept beside them rather than widening `LaneRun`, which
	// `time-lanes.ts` owns and which nothing about packing lanes needs.
	records: ReadonlyArray<RunTimeRecord>
	undated_count: number
}

interface Frame {
	span: Interval
	span_ms: number
	lanes: Array<Lane>
}

function to_run(record: RunTimeRecord): LaneRun | undefined {
	const started_ms = time_instant.parse_instant(record.started_at)
	const ended_ms = time_instant.parse_instant(record.ended_at)

	if (started_ms === undefined || ended_ms === undefined) return undefined

	return { issue: record.issue, started_ms, ended_ms }
}

function is_run(run: LaneRun | undefined): run is LaneRun {
	return run !== undefined
}

// The window is counted back from the newest run recorded, not from the current clock: a report read
// on Monday about work done on Friday must not answer "nothing happened" because the calendar moved.
function cutoff_of(runs: ReadonlyArray<LaneRun>, days: number): number {
	return Math.max(...runs.map((run) => run.ended_ms)) - days * DAY_MS
}

// **The window is decided on the record, so the lane table and the turn table select the same runs.**
// Filtering runs and records through two predicates is how one report would come to aggregate turns
// over a set its own lane table never held (joshuafolkken/kit#1763).
function is_dated_within(record: RunTimeRecord, cutoff: number): boolean {
	const run = to_run(record)

	return run !== undefined && run.ended_ms >= cutoff
}

// **The excluded records are counted inside the period too, not across the whole file.** The history
// keeps two hundred runs, so a count taken over all of them would tell someone asking about one day
// that a hundred and ninety-eight records were excluded from it — records that were never in that day
// to begin with. A record with no window is placed by the instant it was appended, the only instant
// it carries; that decides which period it is counted against, never whether it is excluded.
function is_undated_within(record: RunTimeRecord, cutoff: number): boolean {
	if (to_run(record) !== undefined) return false

	return (time_instant.parse_instant(record.recorded_at) ?? NONE) >= cutoff
}

function to_iso(instant_ms: number): string {
	return new Date(instant_ms).toISOString()
}

function ratio(part: number, whole: number): number {
	return whole <= NONE ? NONE : part / whole
}

function per_hour(run_count: number, span_ms: number): number {
	return ratio(run_count, span_ms) * HOUR_MS
}

function total_ms(intervals: ReadonlyArray<Interval>): number {
	return intervals.reduce((sum, interval) => sum + (interval.ended_ms - interval.started_ms), NONE)
}

function lane_totals(lane: Lane, span_ms: number): LaneTotals {
	return {
		index: lane.index,
		run_count: lane.runs.length,
		busy_ms: lane.busy_ms,
		idle_ms: Math.max(span_ms - lane.busy_ms, NONE),
		issues: lane.runs.map((run) => run.issue),
	}
}

function day_of(run: LaneRun): string {
	return to_iso(run.ended_ms).slice(NONE, DATE_END)
}

function day_totals(runs: ReadonlyArray<LaneRun>, date: string): DayTotals {
	const of_day = runs.filter((run) => day_of(run) === date)

	return {
		date,
		run_count: of_day.length,
		elapsed_ms: of_day.reduce((sum, run) => sum + time_lanes.duration_of(run), NONE),
	}
}

// Issues finished per day, in date order — the trend the period is asked about, kept beside the lane
// table because "more lanes" and "more issues a day" are the two halves of the same question.
function by_day_of(runs: ReadonlyArray<LaneRun>): Array<DayTotals> {
	const dates = new Set(runs.map((run) => day_of(run)))

	return [...dates]
		.toSorted((left, right) => left.localeCompare(right))
		.map((date) => day_totals(runs, date))
}

function undated_note(count: number): string {
	return `${String(count)} record(s) carry no wall-clock window and are excluded from the lane table — they were recorded before the window was stored.`
}

// The contributor table's counterpart to `undated_note` (joshuafolkken/kit#1763). A record the table
// cannot sample is owed a reason, or a reader meeting eight `not measured` rows reads them as a
// broken measurement. **Both causes are named, because a run recorded today with no transcript
// attributed writes no breakdown either** — saying only that such a record predates the field would
// be a false statement about a line written minutes earlier.
function unturned_note(count: number): string {
	return `${String(count)} record(s) carry no turn breakdown and are excluded from the contributor table — they were recorded before the breakdown was stored, or merged with no session transcript attributed.`
}

function notes_of(
	lane_count: number,
	undated_count: number,
	unturned_count: number,
): Array<string> {
	const single = lane_count <= ONE ? [SINGLE_LANE_NOTE] : []
	const undated = undated_count > NONE ? [undated_note(undated_count)] : []
	const unturned = unturned_count > NONE ? [unturned_note(unturned_count)] : []

	return [...single, ...undated, ...unturned]
}

function frame_of(runs: ReadonlyArray<LaneRun>): Frame {
	const span = time_lanes.span_of(runs) ?? EMPTY_SPAN

	return {
		span,
		span_ms: span.ended_ms - span.started_ms,
		lanes: time_lanes.assign_lanes(runs),
	}
}

function window_of(input: PeriodInput, frame: Frame): PeriodWindow {
	return {
		scope: `last ${String(input.period_days)} day(s)`,
		period_days: input.period_days,
		started_at: to_iso(frame.span.started_ms),
		ended_at: to_iso(frame.span.ended_ms),
		span_ms: frame.span_ms,
		run_count: input.runs.length,
		undated_count: input.undated_count,
	}
}

function throughput_of(runs: ReadonlyArray<LaneRun>, frame: Frame): PeriodThroughput {
	const busy_ms = runs.reduce((sum, run) => sum + time_lanes.duration_of(run), NONE)

	return {
		lane_count: frame.lanes.length,
		lanes: frame.lanes.map((lane) => lane_totals(lane, frame.span_ms)),
		busy_ms,
		runs_per_hour: per_hour(runs.length, frame.span_ms),
		effective_lanes: ratio(busy_ms, frame.span_ms),
	}
}

// **The stretches are ranked by how long they were, not left in clock order.** The question a
// serialization block answers is which wait to remove first, and a cap that kept the earliest rows
// would answer a different one.
function contention_of(runs: ReadonlyArray<LaneRun>, lane_count: number): PeriodContention {
	const serialization = time_lanes
		.serial_intervals(runs, lane_count)
		.toSorted(
			(left, right) => right.ended_ms - right.started_ms - (left.ended_ms - left.started_ms),
		)

	return {
		serialization,
		serialized_ms: total_ms(serialization),
		...time_lanes.exposure_of(runs),
		by_day: by_day_of(runs),
	}
}

function to_report(input: PeriodInput): PeriodTimeReport {
	const frame = frame_of(input.runs)
	const throughput = throughput_of(input.runs, frame)
	// Read once and used twice — by the table and by the note that says how much of it was withheld —
	// so the two cannot come to disagree about which records carried a breakdown.
	const totals = input.records.map((record) => time_history.parent_turns_of(record))

	return {
		...window_of(input, frame),
		...throughput,
		...contention_of(input.runs, throughput.lane_count),
		contributors: time_contributors.contributor_rows(totals),
		notes: notes_of(
			throughput.lane_count,
			input.undated_count,
			totals.filter((entry) => !entry.is_measured).length,
		),
	}
}

// **No run to report on is `undefined`, not an empty report.** A checkout whose history was never
// written and a period in which nothing ran are different answers, and only the second one is a
// measurement. The empty-window guard is the same rule at the boundary: a caller asking for a
// negative number of days would otherwise be handed a report whose window sits at the epoch, which
// is exactly the placement this module refuses to make for an undated record.
function build_period_report(
	days: number,
	cwd: string,
	read: RecordReader = time_history.read_records,
): PeriodTimeReport | undefined {
	const records = read(cwd)
	const dated = records.map((record) => to_run(record)).filter(is_run)

	if (dated.length === NONE) return undefined

	const cutoff = cutoff_of(dated, days)
	const kept = records.filter((record) => is_dated_within(record, cutoff))
	const runs = kept.map((record) => to_run(record)).filter(is_run)

	if (runs.length === NONE) return undefined

	return to_report({
		period_days: days,
		runs,
		records: kept,
		undated_count: records.filter((record) => is_undated_within(record, cutoff)).length,
	})
}

const time_period = {
	SINGLE_LANE_NOTE,
	undated_note,
	unturned_note,
	build_period_report,
}

export { time_period }
export type { DayTotals, LaneTotals, PeriodTimeReport }
