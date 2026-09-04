import type { ChildTiming, EpicTimeReport } from './time-epic'
import type { LabelTotal, TimeReport } from './time-report'

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
function cap_table(
	table: string,
	rows: ReadonlyArray<LabelTotal>,
	cap: number,
	notes: Array<string>,
): Array<LabelTotal> {
	if (rows.length <= cap) return [...rows]

	notes.push(truncation_note(table, cap, rows.length))

	return rows.slice(0, cap)
}

// **No cap means the very object that was built.** The acceptance criterion is that an uncapped
// report is byte-identical to what the command printed before this existed, and returning a copy
// would satisfy it only for as long as nobody added a field this module forgot to carry.
function cap_report(report: TimeReport, cap: number | undefined): TimeReport {
	if (cap === undefined) return report

	const notes = [...report.notes]
	const by_tool = cap_table(TOOL_TABLE, report.by_tool, cap, notes)
	const by_josh_command = cap_table(JOSH_TABLE, report.by_josh_command, cap, notes)

	return { ...report, by_tool, by_josh_command, notes }
}

function cap_child(timing: ChildTiming, cap: number): ChildTiming {
	return { ...timing, report: cap_report(timing.report, cap) }
}

// An epic carries no table of its own — every row is inside a child's report — so the cap reaches
// the children and the batch's own fields are untouched. That is also where the size is: epic #1262
// pays for both tables once per child.
function cap_epic_report(report: EpicTimeReport, cap: number | undefined): EpicTimeReport {
	if (cap === undefined) return report

	return { ...report, children: report.children.map((child) => cap_child(child, cap)) }
}

const time_row_cap = {
	TOOL_TABLE,
	JOSH_TABLE,
	truncation_note,
	is_truncation_note,
	cap_report,
	cap_epic_report,
}

export { time_row_cap }
