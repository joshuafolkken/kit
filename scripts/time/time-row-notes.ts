import type { RunTiming } from './time-batch'
import { time_row_cap } from './time-row-cap'
import { time_run } from './time-run'

// Which of a batch row's own notes the table prints beneath it (joshuafolkken/kit#1352).
//
// It was `time-epic-report.ts`'s until `--last` needed the same answer. The notes are written by
// `time-run.ts` for every scope, so a renderer that prints none of them leaves that scope with an
// empty per-check table and no sentence saying the read was refused — symptom 2 fixed in one half of
// the places it occurs. Writing the selection twice is the clone `CLAUDE.md` prohibits, in the one
// place where a drift would make `--epic` and `--last` say different things about the same run.

// Indented under the row it belongs to, one rule for both tables. Written as a repeat count rather
// than as a run of spaces a formatter or a reader can silently miscount.
const INDENT_WIDTH = 6
const INDENT = ' '.repeat(INDENT_WIDTH)

// **The two notes a completed row still prints.** Neither is about the GitHub half being missing.
//
// The overlap note says the row's own minutes double-count wall clock two of its sessions shared, so
// the figure — and the batch total it is summed into — cannot be read without it
// (joshuafolkken/kit#1330). The refused-check note says the empty `By CI check` table is a refusal
// rather than a run GitHub recorded no checks for (joshuafolkken/kit#1352). Every completed row has
// `has_ci_data`, which is to say the filter below hides both from exactly the rows that carry them.
function is_kept_note(note: string): boolean {
	return time_run.is_overlap_note(note) || time_run.is_check_read_note(note)
}

// **Why a row is short of a measurement, in its own words.** `not run` is one status covering several
// facts the run scope keeps carefully apart — no pull request exists, none was found within the page
// budget, and *the listing could not be read at all* — and a table that printed only the status would
// report a rate-limited `gh` as a batch that never reached its rows. The sentences are
// `time-run.ts`'s own, carried up rather than restated, so the scopes cannot disagree about what was
// and was not established.
//
// The full set prints only where **no merge was read**, which is exactly where the row cannot say
// why: a row whose merge *was* read already carries its answer in the columns, and repeating its
// notes beneath would bury the rows that have something to add.
//
// **A `--top` truncation note is never one of them** (joshuafolkken/kit#1301). It is about the
// per-tool and per-`josh <cmd>` tables, which these renderings do not print at all, and an unmerged
// row has both a populated table and no CI data — so without the filter it would land in exactly the
// block that exists to say why the GitHub half is missing.
function notes_of(timing: RunTiming): Array<string> {
	const notes = timing.report.notes.filter((note) => !time_row_cap.is_truncation_note(note))

	if (!timing.report.has_ci_data) return notes

	return notes.filter((note) => is_kept_note(note))
}

function note_lines(timing: RunTiming): Array<string> {
	return notes_of(timing).map((note) => `${INDENT}${note}`)
}

const time_row_notes = {
	is_kept_note,
	notes_of,
	note_lines,
}

export { time_row_notes }
