import { time_batch, type RunTiming } from './time-batch'
import { time_distribution, type LabeledDistribution } from './time-distribution'
import { time_format } from './time-format'
import type { LastTimeReport } from './time-last'
import { time_report } from './time-report'

// The text a set of runs is read as (joshuafolkken/kit#1312).
//
// Split from `time-last.ts` for the reason `time-epic-report.ts` was split from `time-epic.ts`: the
// aggregation stays arithmetic and this stays layout. It lays its rows out through
// `time_report.format_columns` and withholds them through `time_report.unmeasured_row`, so a
// distribution table lines up with a run's and says `not measured` in the same words — one column
// rule and one withheld answer across every scope this command has.

const NONE = 0
const RUN_HEADING = 'By run (newest merge first):'
const ELAPSED_HEADING = 'Across the runs (median, then min – max):'
const ELAPSED_LABEL = 'elapsed'
const CATEGORY_HEADING = 'Where the wall clock went (median, then min – max):'
const PHASE_HEADING = 'By phase (in run order, median, then min – max):'
const CHECK_HEADING = 'By CI check (descending by median, jobs overlap):'
const RANGE_SEPARATOR = ' – '
// The same separator every other third column in this command is punctuated with, taken from
// `time-format.ts` rather than spelled out again.
const { SUFFIX_SEPARATOR, note_lines } = time_format

// **The median goes in the numeric column and the range in the suffix**, so a reader scanning the
// column is scanning one comparable figure per row rather than three. The sample count rides at the
// end because it is the qualifier: two rows with the same spread are not the same evidence when one
// was read from five runs and the other from two.
function spread_suffix(row: LabeledDistribution): string {
	const { min_ms, max_ms, sample_count } = row.distribution
	const range = [min_ms, max_ms]
		.map((value) => time_format.format_minutes(value))
		.join(RANGE_SEPARATOR)

	return `${range}${SUFFIX_SEPARATOR}${String(sample_count)} run(s)`
}

// **A row nobody could sample says `not measured`, never `0.0 min`.** It is the acceptance criterion
// of this whole change at the level of one line: a phase no run detected and a phase every run spent
// no time in are different answers, and only the first is withheld.
function distribution_line(row: LabeledDistribution): string {
	if (!time_distribution.is_measured(row.distribution)) return time_report.unmeasured_row(row.label)

	return time_report.format_row(row.label, row.distribution.median_ms, spread_suffix(row))
}

// **Uncapped, because these tables are bounded by the vocabulary rather than by the length of a
// run.** Four category rows and one phase row per name in `PHASE_ORDER` — and `--issue`'s own phase
// table prints whole for the same reason, so a display cap here would drop a phase from one scope and
// not the other the moment a sixteenth is added.
function table_lines(
	heading: string,
	rows: ReadonlyArray<LabeledDistribution>,
	tail: ReadonlyArray<string> = [],
): Array<string> {
	if (rows.length === NONE) return []

	return ['', heading, ...rows.map((row) => distribution_line(row)), ...tail]
}

// The check table is the one that grows with what CI happens to be configured to run, so it takes the
// same 15-row display cap and overflow note every other table in this command prints through — taken
// from `time-format.ts` rather than restated.
function check_lines(report: LastTimeReport): Array<string> {
	const { checks } = report

	return table_lines(
		CHECK_HEADING,
		checks.slice(0, time_format.MAX_ROWS),
		time_format.overflow_line(checks.length),
	)
}

// **A run that could not be measured at all prints its status where a duration would go.** The same
// shape an undetected phase and a never-run epic child already print, for the same reason: the column
// is empty because there is no duration, not because the duration was short.
function run_line(timing: RunTiming): string {
	const label = `#${String(timing.issue_number)}`

	if (timing.status === time_batch.NOT_RUN) {
		return time_report.format_columns(label, '', timing.status)
	}

	return time_report.format_row(label, timing.report.elapsed_ms, timing.status)
}

// Printed even for a single run, because the list is what says *which* runs the figures above came
// from — a distribution whose sample nobody can name is not one a reader can check.
function run_lines(report: LastTimeReport): Array<string> {
	if (report.runs.length === NONE) return []

	return ['', RUN_HEADING, ...report.runs.map((timing) => run_line(timing))]
}

function elapsed_lines(report: LastTimeReport): Array<string> {
	return table_lines(ELAPSED_HEADING, [{ label: ELAPSED_LABEL, distribution: report.elapsed }])
}

// `measured` rather than `timed`: every run here merged, so what varies between them is whether a
// transcript was attributed — and that is the count the rows below are actually read from.
function heading_of(report: LastTimeReport): string {
	const counts = `${String(report.measured_count)} of ${String(report.runs.length)} fully measured`

	return `${report.scope} — ${counts}`
}

function format_last_report(report: LastTimeReport): string {
	return [
		heading_of(report),
		...note_lines(report.notes),
		...run_lines(report),
		...elapsed_lines(report),
		...table_lines(CATEGORY_HEADING, report.categories),
		...table_lines(PHASE_HEADING, report.phases),
		...check_lines(report),
	].join('\n')
}

const time_last_report = {
	RUN_HEADING,
	ELAPSED_HEADING,
	ELAPSED_LABEL,
	CATEGORY_HEADING,
	PHASE_HEADING,
	CHECK_HEADING,
	distribution_line,
	format_last_report,
}

export { time_last_report }
