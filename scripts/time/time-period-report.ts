import { time_contributors } from './time-contributors'
import { time_format } from './time-format'
import { time_instant } from './time-instant'
import type { SerialInterval } from './time-lanes'
import type { DayTotals, LaneTotals, PeriodTimeReport } from './time-period'

// The text a period is read as (joshuafolkken/kit#1470).
//
// Split from `time-period.ts` for the reason `time-epic-report.ts` was split from `time-epic.ts`:
// the aggregation stays arithmetic and this stays layout. It lays its rows out through
// `time_format.format_row`, so a lane's busy time lines up with a run's phase and a period's window
// with an epic's — one column rule across every scope this command has.
//
// **The lane table is one table, on purpose.** Busy, idle, the share of the window each took and the
// runs that produced them are the same question asked four ways, and a reader comparing lanes across
// four blocks is doing the join the report exists to have done for them.

const NONE = 0
const BLANK = ''
const LANE_OFFSET = 1
const LANE_DECIMALS = 1
const RATE_DECIMALS = 2
// Enough issue numbers to recognize a lane by, before the third column starts wrapping. What is cut
// is said as a count rather than dropped silently.
const MAX_ISSUE_NAMES = 4
const HEADING_PREFIX = 'Period report'
const LANE_HEADING = 'By lane (busy, then idle against the window):'
const SERIAL_HEADING = 'Serialization (one lane held while the others waited, longest first):'
const WAIT_HEADING = 'Waits (whether anything else was running beside them):'
// UTC, said out loud: every instant this report prints comes off an ISO string, so a row labelled
// with a local date would be the one figure in the block read against a different clock.
const DAY_HEADING = 'Issues finished per day (UTC):'
const WINDOW_LABEL = 'window'
const HIDDEN_LABEL = 'hidden by another run'
const EXPOSED_LABEL = 'exposed bare'
// To the minute, and **with the date**. `time_format.format_window` prints a clock alone, which is
// right for a run that sits inside one day and ambiguous for a period that spans several:
// `00:00:00 → 06:20:00` reads as six hours when the window was thirty. The run scope's helper is left
// as it is rather than widened for this one caller.
const DATE_END = 10
const CLOCK_START = 11
const CLOCK_END = 16
const WINDOW_ARROW = ' → '
const NO_SERIALIZATION = '  none — no stretch had one run holding the only busy lane'

const {
	MAX_ROWS,
	SUFFIX_SEPARATOR,
	format_minutes,
	format_row,
	format_share,
	note_lines,
	overflow_line,
} = time_format

function instant_label(instant_ms: number): string {
	const iso = new Date(instant_ms).toISOString()

	return `${iso.slice(NONE, DATE_END)} ${iso.slice(CLOCK_START, CLOCK_END)}`
}

function window_label(started_ms: number, ended_ms: number): string {
	return `${instant_label(started_ms)}${WINDOW_ARROW}${instant_label(ended_ms)}`
}

function run_count(count: number): string {
	return `${String(count)} run(s)`
}

function lane_count(count: number): string {
	return `${String(count)} lane(s)`
}

function issue_names(issues: ReadonlyArray<number>): string {
	const shown = issues
		.slice(NONE, MAX_ISSUE_NAMES)
		.map((issue) => `#${String(issue)}`)
		.join(', ')
	const rest = issues.length - MAX_ISSUE_NAMES

	return rest > NONE ? `${shown} +${String(rest)}` : shown
}

// Every block is capped the same way and says what it withheld, so a long period cannot quietly
// print a different amount of one table than of another.
function table(heading: string, rows: ReadonlyArray<string>): Array<string> {
	return [heading, ...rows.slice(NONE, MAX_ROWS), ...overflow_line(rows.length)]
}

function lane_line(lane: LaneTotals, span_ms: number): string {
	const suffix = [
		`idle ${format_minutes(lane.idle_ms)}`,
		`${format_share(lane.busy_ms, span_ms)} busy`,
		run_count(lane.run_count),
		issue_names(lane.issues),
	].join(SUFFIX_SEPARATOR)

	return format_row(`lane ${String(lane.index + LANE_OFFSET)}`, lane.busy_ms, suffix)
}

// **The effective lane count is the headline, beside the lane count itself.** "Three lanes" says how
// many were opened; "1.4 effective" says how many were actually carrying work, which is the only one
// of the two that answers whether opening the third bought anything.
function window_line(report: PeriodTimeReport): string {
	const started_ms = time_instant.parse_instant(report.started_at) ?? NONE
	const ended_ms = time_instant.parse_instant(report.ended_at) ?? NONE
	const suffix = [
		window_label(started_ms, ended_ms),
		`${report.effective_lanes.toFixed(LANE_DECIMALS)} effective of ${lane_count(report.lane_count)}`,
		`${report.runs_per_hour.toFixed(RATE_DECIMALS)} runs/hour`,
	].join(SUFFIX_SEPARATOR)

	return format_row(WINDOW_LABEL, report.span_ms, suffix)
}

// The stretch is named by the run that held it — that run is what everything else was behind, which
// is the cause the acceptance criterion asks for and the only one wall clock alone can support.
function serial_line(interval: SerialInterval): string {
	return format_row(
		`#${String(interval.issue)}`,
		interval.ended_ms - interval.started_ms,
		window_label(interval.started_ms, interval.ended_ms),
	)
}

// **`none` is an answer here, not an omitted block.** A period with nothing serialized and a period
// nobody examined for serialization look identical when the heading simply disappears.
function serial_lines(report: PeriodTimeReport): Array<string> {
	if (report.serialization.length === NONE) return [SERIAL_HEADING, NO_SERIALIZATION]

	return table(
		SERIAL_HEADING,
		report.serialization.map((interval) => serial_line(interval)),
	)
}

function wait_lines(report: PeriodTimeReport): Array<string> {
	return [
		WAIT_HEADING,
		format_row(HIDDEN_LABEL, report.hidden_ms, format_share(report.hidden_ms, report.busy_ms)),
		format_row(EXPOSED_LABEL, report.exposed_ms, format_share(report.exposed_ms, report.busy_ms)),
	]
}

function day_line(day: DayTotals): string {
	return format_row(day.date, day.elapsed_ms, run_count(day.run_count))
}

function heading_of(report: PeriodTimeReport): string {
	const across = `${run_count(report.run_count)} across ${lane_count(report.lane_count)}`

	return `${HEADING_PREFIX} — ${report.scope}: ${across}`
}

function format_period_report(report: PeriodTimeReport): string {
	return [
		heading_of(report),
		window_line(report),
		...note_lines(report.notes),
		BLANK,
		...table(
			LANE_HEADING,
			report.lanes.map((lane) => lane_line(lane, report.span_ms)),
		),
		BLANK,
		...serial_lines(report),
		BLANK,
		...wait_lines(report),
		BLANK,
		...table(
			DAY_HEADING,
			report.by_day.map((day) => day_line(day)),
		),
		...time_contributors.contributor_lines(report.contributors),
	].join('\n')
}

const time_period_report = {
	LANE_HEADING,
	SERIAL_HEADING,
	WAIT_HEADING,
	NO_SERIALIZATION,
	format_period_report,
}

export { time_period_report }
