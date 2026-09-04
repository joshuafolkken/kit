import { time_batch, type RunTiming } from './time-batch'
import type { EpicTimeReport, EpicTrend } from './time-epic'
import { time_format } from './time-format'
import { time_report } from './time-report'
import { time_row_notes } from './time-row-notes'

// The text an epic's batch is read as (joshuafolkken/kit#1271).
//
// Split from `time-epic.ts` so the aggregation stays arithmetic and this stays layout, and it lays
// its rows out through `time_report.format_columns` rather than a second set of widths — one column
// rule, so an epic's table lines up with a run's.

const { note_lines } = time_format

const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 0
// Below half a point the printed figure rounds to `0%`, so anything under it is reported as flat
// rather than as a direction the number does not show.
const FLAT_PERCENT = 0.5
const NONE = 0
const CHILD_HEADING = 'By child (in execution order):'
const CATEGORY_HEADING = "Where the batch's wall clock went:"
const TREND_HEADING = 'Model wait per turn (in execution order):'
const NO_CHILDREN =
	'the epic body tracks no children as task-list rows, so there is nothing to time'
const NO_TREND_LINE = '  not enough children recorded a turn to say whether it is rising'
const NO_TRANSCRIPT_SHARES = 'CI wait only — no session transcript is attributed to this child'

// The share column of a child's row: the same four categories the batch total prints, in minutes,
// so a long child can be read against the batch without opening `--json`.
//
// **A child whose transcript half is missing prints none of the three transcript shares.** Its
// model, tool and human totals are zero because nothing was read, not because nothing happened, and
// printing `model 0.0 min` there is exactly the measured zero standing in for an unknown that the
// status exists to prevent.
function child_shares(timing: RunTiming): string {
	if (timing.status === time_batch.NO_TRANSCRIPT) return NO_TRANSCRIPT_SHARES

	const { categories, has_ci_data } = timing.report
	const parts = [
		`model ${time_report.format_minutes(categories.model_ms)}`,
		`tool ${time_report.format_minutes(categories.tool_ms)}`,
		`human ${time_report.format_minutes(categories.human_ms)}`,
		...(has_ci_data ? [`CI ${time_report.format_minutes(categories.ci_ms)}`] : []),
	]

	return parts.join(' / ')
}

// **A child that was never run prints its status where a duration would go, not `0.0 min`.** The
// duration column is left empty because there is no duration — not a short one — which is the same
// answer, in the same shape, that an undetected phase already gives.
function child_line(timing: RunTiming): string {
	const label = `#${String(timing.issue_number)}`

	if (!time_batch.has_duration(timing)) {
		return time_report.format_columns(label, '', timing.status)
	}

	return time_report.format_row(label, timing.report.elapsed_ms, child_shares(timing))
}

// **Which of a child's own notes reach the table is `time-row-notes.ts`'s** (joshuafolkken/kit#1352).
// The selection was this file's until `--last` needed the same answer, and a second copy of it is
// where the two batch scopes come to say different things about the same run. The idle note stays
// behind its filter for the reason recorded there: time that belonged to nobody leaves the row's own
// figure correct.
function child_block(timing: RunTiming): Array<string> {
	return [child_line(timing), ...time_row_notes.note_lines(timing)]
}

function child_lines(report: EpicTimeReport): Array<string> {
	if (report.children.length === NONE) return []

	return ['', CHILD_HEADING, ...report.children.flatMap((timing) => child_block(timing))]
}

// **A share nobody read says so rather than totalling zero.** The batch totals are a sum over the
// children, so a half no child contributed sums to `0.0 min` — which reads as "the batch spent no
// time waiting on the model" when the truth is that no transcript was read at all. The row itself is
// `time_report.unmeasured_row`, shared with the run scope since joshuafolkken/kit#1295 so one word
// and one column rule answer this question at both scales.
function category_row(
	label: string,
	duration_ms: number,
	is_known: boolean,
	total_ms: number,
): string {
	if (!is_known) return time_report.unmeasured_row(label)

	return time_report.format_row(label, duration_ms, time_report.format_share(duration_ms, total_ms))
}

function category_lines(report: EpicTimeReport): Array<string> {
	const { categories, total_ms, has_transcript_data } = report
	const rows: Array<[string, number, boolean]> = [
		[time_report.MODEL_LABEL, categories.model_ms, has_transcript_data],
		[time_report.TOOL_LABEL, categories.tool_ms, has_transcript_data],
		[time_report.HUMAN_LABEL, categories.human_ms, has_transcript_data],
		[time_report.CI_LABEL, categories.ci_ms, report.has_ci_data],
	]

	return [
		'',
		CATEGORY_HEADING,
		...rows.map(([label, value, is_known]) => category_row(label, value, is_known, total_ms)),
	]
}

// A change that rounds away to nothing is `flat`, not `rising 0%`. The printed figure carries no
// decimals, so `>= 0` alone made two children at an identical rate assert a rise — in the one
// section the batch scope exists for.
function direction_phrase(change: number): string {
	if (Math.abs(change) < FLAT_PERCENT) return 'flat'

	const word = change > NONE ? 'rising' : 'falling'

	return `${word} ${Math.abs(change).toFixed(PERCENT_DECIMALS)}%`
}

// The direction, as a percentage of the first figure. Named rather than left for the reader to
// divide, because the whole question the batch scope was added for is whether the later children are
// slower per turn than the earlier ones.
function direction_line(trend: EpicTrend): string {
	const change =
		((trend.last_ms_per_turn - trend.first_ms_per_turn) / trend.first_ms_per_turn) * PERCENT_SCALE

	return `  ${direction_phrase(change)} across ${String(trend.child_count)} children`
}

// One row per child that recorded a turn, so the shape of the change is visible rather than only its
// endpoints — two children rising 40% and four children flat but for a slow last one read the same
// from a single ratio.
function per_turn_line(timing: RunTiming): Array<string> {
	const { ms_per_turn } = timing

	if (ms_per_turn === undefined) return []

	const label = `#${String(timing.issue_number)}`

	// Trimmed because the row has no share column to fill: the layout still puts the separator there,
	// and a line of trailing spaces is what a reader's diff tool complains about.
	return [time_report.format_columns(label, time_report.format_seconds(ms_per_turn), '').trimEnd()]
}

// Printed even when no child recorded a turn. Dropping the section there would leave a reader who
// came for the per-turn trend unable to tell whether it was measured and flat or never measured at
// all — the silence this command answers everywhere else in words.
function trend_lines(report: EpicTimeReport): Array<string> {
	const rows = report.children.flatMap((timing) => per_turn_line(timing))
	const tail = report.trend.is_comparable ? direction_line(report.trend) : NO_TREND_LINE

	return ['', TREND_HEADING, ...rows, tail]
}

// `timed`, not `measured`: the headline count is the children something was measured for, and how
// much of each was measured is the row's own business. Counting only the fully measured ones would
// have printed `0 measured` beside eleven real minutes on epic #1272.
function heading_of(report: EpicTimeReport): string {
	const counts = `${String(report.children.length)} child(ren), ${String(report.timed_count)} timed`

	return `${report.scope} — ${counts}, ${time_report.format_minutes(report.total_ms)} elapsed`
}

// An epic with no tracked children says so instead of printing a table of zeroes — the same answer,
// for the same reason, that a transcript with no timed lines gets.
function format_empty(report: EpicTimeReport): string {
	return [`${report.scope} — ${NO_CHILDREN}`, ...note_lines(report.notes)].join('\n')
}

function format_epic_report(report: EpicTimeReport): string {
	if (report.children.length === NONE) return format_empty(report)

	return [
		heading_of(report),
		...note_lines(report.notes),
		...child_lines(report),
		...category_lines(report),
		...trend_lines(report),
	].join('\n')
}

const time_epic_report = {
	CHILD_HEADING,
	CATEGORY_HEADING,
	TREND_HEADING,
	NO_CHILDREN,
	format_empty,
	format_epic_report,
}

export { time_epic_report }
