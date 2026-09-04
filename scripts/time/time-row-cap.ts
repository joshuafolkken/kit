import type { RunTiming } from './time-batch'
import type { EpicTimeReport } from './time-epic'
import type { LastTimeReport } from './time-last'
import type { TimeReport } from './time-report'
import type { Segment } from './time-segments'

// Capping the per-tool and per-`josh <cmd>` tables a report carries (joshuafolkken/kit#1301).
//
// `--json` used to carry every row of both, and `diag` reads that JSON whole: epic #1262 measured
// 47.7 KB when it had 9 children, and the tail of each table — the rows nobody ranks — is paid for
// in tokens on every reading. What the `diag` skill says it uses from those two tables is the
// handful of rows at the top, so the cap is on the rows rather than on the tables.
//
// **It sits between the aggregation and the output, not inside either.** `time-report.ts` still
// builds every row, so `--session` / `--issue` / `--epic` measure exactly what they measured before
// and the text formatter's own 15-row display cap is untouched. This module is applied by
// `time-cli.ts` immediately before printing, which is the one place that knows whether a cap was
// asked for.
//
// **Truncation is stated, never silent.** A table that quietly stops at N reads as "the rest were
// zero" — the same misreading `time-report.ts` withholds its `not measured` rows to prevent — so a
// cut table adds a note naming how many rows it kept out of how many there were. The note rides in
// `notes`, which both `--json` and the text report already carry, so neither output needs a second
// way of saying it.

// The two tables the cap applies to, spelled as they are keyed in the JSON so a note names the field
// a reader would go looking for. `by_check` is deliberately not one of them: its rows are one per CI
// job, a dozen at most, and capping them would hide a check rather than a tail.
const TOOL_TABLE = 'by_tool'
const JOSH_TABLE = 'by_josh_command'
// The two tables joshuafolkken/kit#1311 added. Both grow with the run rather than with the number of
// distinct commands — a long run has a segment per stretch and a row per repeated command — which is
// exactly the unbounded growth this cap exists for.
//
// **A capped `segments` no longer sums to the elapsed time, and the note is what says so.** The
// reconciliation is a property of the report as it was built, and `--top` is a cut made for the
// reader's sake at the moment of printing — the same trade `by_tool` already makes against
// `tool execution`.
const SEGMENT_TABLE = 'segments'
const INVOCATION_TABLE = 'by_invocation'
// The tail every truncation note ends with, so a renderer that has to tell one apart from the notes
// beside it matches this rather than a phrase it spells out for itself.
const WITHHELD_SUFFIX = 'withheld by --top'

function truncation_note(table: string, kept: number, total: number): string {
	const dropped = total - kept

	return `${table}: showing the top ${String(kept)} of ${String(total)} rows — ${String(dropped)} ${WITHHELD_SUFFIX}`
}

// **Only the run scope's own table prints these.** An epic's text report renders no per-tool table at
// all, and the one place it prints a child's notes is the block explaining why that child's GitHub
// half is missing — a rate-limited `gh` against a child never reached. A truncation note there is
// about tables that rendering does not show, sitting in the block that exists to answer a different
// question entirely.
function is_truncation_note(note: string): boolean {
	return note.endsWith(WITHHELD_SUFFIX)
}

// The note is pushed rather than returned so a caller can cut both tables into one list of notes;
// two returned optionals would have to be filtered and concatenated at every call site.
function cap_table<Row>(
	table: string,
	rows: ReadonlyArray<Row>,
	cap: number,
	notes: Array<string>,
): Array<Row> {
	if (rows.length <= cap) return [...rows]

	notes.push(truncation_note(table, cap, rows.length))

	return rows.slice(0, cap)
}

// **A timeline is cut by length, never by position** (joshuafolkken/kit#1311). Every other table here
// is already sorted descending, so taking the first `cap` rows *is* taking the heaviest. The segment
// table is in run order, where the same slice keeps the earliest stretches and drops the pull request,
// the CI wait and the merge — and `diag` calls with a fixed `--top 5`, so it would rank candidates
// against a timeline that ends before the half it is looking for while reading as complete. So the
// longest segments are kept, and then put back in run order: the rows are a sample of the run rather
// than its opening.
function cap_segments(
	rows: ReadonlyArray<Segment>,
	cap: number,
	notes: Array<string>,
): Array<Segment> {
	const longest = rows.toSorted((left, right) => right.duration_ms - left.duration_ms)

	return cap_table(SEGMENT_TABLE, longest, cap, notes).toSorted(
		(left, right) => left.started_ms - right.started_ms,
	)
}

// **No cap means the very object that was built.** The acceptance criterion is that an uncapped
// report is byte-identical to what the command printed before this existed, and returning a copy
// would satisfy it only for as long as nobody added a field this module forgot to carry.
function cap_report(report: TimeReport, cap: number | undefined): TimeReport {
	if (cap === undefined) return report

	const notes = [...report.notes]
	const capped = {
		by_tool: cap_table(TOOL_TABLE, report.by_tool, cap, notes),
		by_josh_command: cap_table(JOSH_TABLE, report.by_josh_command, cap, notes),
		segments: cap_segments(report.segments, cap, notes),
		by_invocation: cap_table(INVOCATION_TABLE, report.by_invocation, cap, notes),
	}

	return { ...report, ...capped, notes }
}

function cap_run(timing: RunTiming, cap: number): RunTiming {
	return { ...timing, report: cap_report(timing.report, cap) }
}

// An epic carries no table of its own — every row is inside a child's report — so the cap reaches
// the children and the batch's own fields are untouched. That is also where the size is: epic #1262
// pays for both tables once per child.
function cap_epic_report(report: EpicTimeReport, cap: number | undefined): EpicTimeReport {
	if (cap === undefined) return report

	return { ...report, children: report.children.map((child) => cap_run(child, cap)) }
}

// A set of runs carries no unbounded table of its own either — the four category rows, the fifteen
// phase rows and one row per CI job are all bounded by the vocabulary rather than by the length of a
// run — so the cap reaches the runs, exactly as it reaches an epic's children. **The check
// distribution is deliberately left uncapped** for the reason `by_check` is: its rows are one per CI
// job, and cutting them would hide a check rather than a tail (joshuafolkken/kit#1312).
function cap_last_report(report: LastTimeReport, cap: number | undefined): LastTimeReport {
	if (cap === undefined) return report

	return { ...report, runs: report.runs.map((run) => cap_run(run, cap)) }
}

const time_row_cap = {
	TOOL_TABLE,
	JOSH_TABLE,
	SEGMENT_TABLE,
	INVOCATION_TABLE,
	truncation_note,
	is_truncation_note,
	cap_report,
	cap_epic_report,
	cap_last_report,
}

export { time_row_cap }
