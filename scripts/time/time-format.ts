// The column and number formatting every timing report is laid out through (joshuafolkken/kit#1309).
//
// It was `time-report.ts`'s until three renderers shared it: the run scope's own tables, the epic
// scope's child rows, and the failure block `time-failures.ts` prints. Two of those already reached
// in through the `time_report` namespace for the widths, which is what made the split the honest
// place to cut — a second set of column rules beside a second renderer is the clone `CLAUDE.md`
// prohibits, in the one place where a drift would make two tables of the same report disagree about
// where the numeric column starts.
//
// **It holds no timing knowledge at all** — no spans, no categories, no phases. That is what keeps
// the dependency one-way: `time-report.ts` and `time-failures.ts` both import this, and nothing here
// imports either of them.

const MS_PER_MINUTE = 60_000
const MS_PER_SECOND = 1000
const MINUTE_DECIMALS = 1
const SECOND_DECIMALS = 1
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1
const LABEL_WIDTH = 24
// Wide enough for a three-digit run (`335.4 min`), so a long session's rows stay in column with a
// short one's rather than pushing the share out by a character.
const MINUTES_WIDTH = 9
// The answer a table gives where the half it sums was never read at all, kept apart from the phase
// table's `not detected` because the two ask different questions: a phase is about a marker, this is
// about whether anything was read to measure.
const NOT_MEASURED = 'not measured'
// How many rows of a table any of these reports prints. Capped, because a long run touches thirty-odd
// distinct leading commands and a table that long is read by nobody. `--json` carries every row the
// report holds, so the display cap costs a caller nothing.
//
// **It moved here when the segment and per-invocation tables became the fourth and fifth renderers to
// need it** (joshuafolkken/kit#1311). Those two cannot import `time-report.ts`, which imports them —
// and a second cap beside a second renderer is exactly the drift this file was split out to prevent.
const MAX_ROWS = 15

// **The parenthetical says "this report" rather than "them all"** (joshuafolkken/kit#1301): since
// `--top` can cut the record itself before either rendering, a promise that `--json` carries every row
// *there ever was* would be false beside a `--top` above this display cap — and the report would then
// contradict its own truncation note. What was cut from the record, if anything, is said in `notes`;
// what is cut from a table is said here.
function overflow_line(row_count: number): Array<string> {
	if (row_count <= MAX_ROWS) return []

	return [
		`  … and ${String(row_count - MAX_ROWS)} more (--json carries every row this report holds)`,
	]
}

function format_minutes(duration_ms: number): string {
	return `${(duration_ms / MS_PER_MINUTE).toFixed(MINUTE_DECIMALS)} min`
}

// Seconds rather than minutes for a per-turn figure: one turn is tens of seconds, and `0.1 min` is
// too coarse to show the rise across a batch that this scale exists to make visible.
function format_seconds(duration_ms: number): string {
	return `${(duration_ms / MS_PER_SECOND).toFixed(SECOND_DECIMALS)} s`
}

function format_share(part: number, whole: number): string {
	if (whole === 0) return 'n/a'

	return `${((part / whole) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`
}

// The one place the three columns are laid out, so a row carrying words instead of a duration lines
// up with the rows that carry one rather than overrunning the numeric column.
function format_columns(label: string, minutes: string, suffix: string): string {
	return `  ${label.padEnd(LABEL_WIDTH)}${minutes.padStart(MINUTES_WIDTH)}   ${suffix}`
}

function format_row(label: string, duration_ms: number, suffix: string): string {
	return format_columns(label, format_minutes(duration_ms), suffix)
}

// **A share nobody read says so rather than totalling zero.** The duration column is left empty
// because there is no duration — not a short one — which is the same shape an undetected phase and a
// child that never ran already print.
function unmeasured_row(label: string): string {
	return format_columns(label, '', NOT_MEASURED)
}

const time_format = {
	MAX_ROWS,
	NOT_MEASURED,
	overflow_line,
	format_minutes,
	format_seconds,
	format_share,
	format_columns,
	format_row,
	unmeasured_row,
}

export { time_format }
