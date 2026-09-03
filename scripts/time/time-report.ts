import { time_spans, type Span, type SpanCategory, type Timeline } from './time-spans'

// Aggregating timed spans into the report a person reads (joshuafolkken/kit#1267).
//
// It takes spans rather than a transcript so the later children of epic #1262 can reuse it: a phase
// breakdown slices the same array by boundary, and an epic aggregation concatenates several
// sessions' arrays before calling this. Neither needs a second aggregator.

const MS_PER_MINUTE = 60_000
const MINUTE_DECIMALS = 1
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1
const MAX_ROWS = 15
const LABEL_WIDTH = 24
// Wide enough for a three-digit run (`335.4 min`), so a long session's rows stay in column with a
// short one's rather than pushing the share out by a character.
const MINUTES_WIDTH = 9

// `ci_ms` is the fourth share (joshuafolkken/kit#1268): the part of the pull request's
// open→merge window that no transcript span covers. Disjoint from the other three by construction,
// so the four still reconstruct the elapsed time exactly — the property that makes two runs
// comparable, and the one a naive "add the PR window" would have broken, since `followup --merge`
// waits for CI *inside* a tool span that is already counted.
interface CategoryTotals {
	model_ms: number
	tool_ms: number
	human_ms: number
	ci_ms: number
}

interface LabelTotal {
	label: string
	duration_ms: number
	call_count: number
}

interface TimeReport {
	// What was measured: `session <id>` for one session, `issue #<N>` for a whole run. A label rather
	// than a session id, because a run spans sessions and has no single one to name.
	scope: string
	started_at: string
	ended_at: string
	elapsed_ms: number
	span_count: number
	categories: CategoryTotals
	// Whether the GitHub half was read at all. A session report has no pull request, so printing a
	// `CI wait 0.0 min` row there would assert a measurement nobody made.
	has_ci_data: boolean
	// Whatever the reader has to know to read the figures correctly — how many sessions contributed,
	// which pull request, an unmerged one, an issue with no pull request at all. Printed under the
	// heading rather than swallowed: an unknown is reported, never rendered as a zero.
	notes: Array<string>
	by_tool: Array<LabelTotal>
	by_josh_command: Array<LabelTotal>
	by_check: Array<LabelTotal>
}

// Everything `build_from_spans` needs. A record rather than seven positional parameters, which the
// four-parameter limit forbids anyway and which no reader could keep in order.
interface ReportInput {
	scope: string
	spans: ReadonlyArray<Span>
	started_ms: number
	ended_ms: number
	ci_ms: number
	has_ci_data: boolean
	notes: ReadonlyArray<string>
	by_check: ReadonlyArray<LabelTotal>
}

function category_ms(spans: ReadonlyArray<Span>, category: SpanCategory): number {
	return spans
		.filter((span) => span.category === category)
		.reduce((sum, span) => sum + span.duration_ms, 0)
}

// An empty label is not a bucket. Every span carries a category, but only tool spans carry a tool
// name, and only a Bash span running `pnpm josh <cmd>` carries a command — printing the rest under
// a blank row would invent a total nobody measured.
function accumulate(totals: Map<string, LabelTotal>, label: string, duration_ms: number): void {
	if (label === '') return

	const existing = totals.get(label) ?? { label, duration_ms: 0, call_count: 0 }

	totals.set(label, {
		label,
		duration_ms: existing.duration_ms + duration_ms,
		call_count: existing.call_count + 1,
	})
}

function totals_by(spans: ReadonlyArray<Span>, key_of: (span: Span) => string): Array<LabelTotal> {
	const totals = new Map<string, LabelTotal>()
	const rows: Array<LabelTotal> = []

	for (const span of spans) accumulate(totals, key_of(span), span.duration_ms)
	// Drained with a loop rather than a spread: `Iterator#toArray` is not in this project's TS lib,
	// and the spread form the linter would otherwise demand does not type-check.
	for (const [, row] of totals) rows.push(row)

	return rows.toSorted((left, right) => right.duration_ms - left.duration_ms)
}

function to_iso(timestamp_ms: number): string {
	return timestamp_ms === 0 ? '' : new Date(timestamp_ms).toISOString()
}

// **Elapsed is the sum of the four shares, not the window's length.** For one session the two are
// the same, because its spans tile its window exactly. For a run they are not: two sessions with a
// day between them leave real time that belonged to nobody, and counting it as elapsed would report
// a run as a day long. So the header states what was accounted for, and `started_at` / `ended_at`
// still carry the wall window a reader can check it against.
function build_from_spans(input: ReportInput): TimeReport {
	const { spans, ci_ms } = input
	const categories = {
		model_ms: category_ms(spans, time_spans.MODEL_CATEGORY),
		tool_ms: category_ms(spans, time_spans.TOOL_CATEGORY),
		human_ms: category_ms(spans, time_spans.HUMAN_CATEGORY),
		ci_ms,
	}

	return {
		scope: input.scope,
		started_at: to_iso(input.started_ms),
		ended_at: to_iso(input.ended_ms),
		elapsed_ms: categories.model_ms + categories.tool_ms + categories.human_ms + ci_ms,
		span_count: spans.length,
		categories,
		has_ci_data: input.has_ci_data,
		notes: [...input.notes],
		by_tool: totals_by(spans, (span) => span.label),
		by_josh_command: totals_by(spans, (span) => span.josh_command),
		by_check: [...input.by_check],
	}
}

// One session, which is the shape `josh time --session` reports. It has no GitHub half, so the CI
// share is zero and the row is withheld rather than printed as a measured zero.
function build_report(session_id: string, timeline: Timeline): TimeReport {
	return build_from_spans({
		scope: `session ${session_id}`,
		spans: timeline.spans,
		started_ms: timeline.started_ms,
		ended_ms: timeline.ended_ms,
		ci_ms: 0,
		has_ci_data: false,
		notes: [],
		by_check: [],
	})
}

function format_minutes(duration_ms: number): string {
	return `${(duration_ms / MS_PER_MINUTE).toFixed(MINUTE_DECIMALS)} min`
}

function format_share(part: number, whole: number): string {
	if (whole === 0) return 'n/a'

	return `${((part / whole) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`
}

function format_row(label: string, duration_ms: number, suffix: string): string {
	return `  ${label.padEnd(LABEL_WIDTH)}${format_minutes(duration_ms).padStart(MINUTES_WIDTH)}   ${suffix}`
}

function ci_line(report: TimeReport): Array<string> {
	if (!report.has_ci_data) return []

	const { ci_ms } = report.categories

	return [format_row('CI wait', ci_ms, format_share(ci_ms, report.elapsed_ms))]
}

function category_lines(report: TimeReport): Array<string> {
	const { categories, elapsed_ms } = report

	return [
		format_row('model wait', categories.model_ms, format_share(categories.model_ms, elapsed_ms)),
		format_row('tool execution', categories.tool_ms, format_share(categories.tool_ms, elapsed_ms)),
		format_row('human wait', categories.human_ms, format_share(categories.human_ms, elapsed_ms)),
		...ci_line(report),
	]
}

// Capped, because a long run touches thirty-odd distinct leading commands and a table that long is
// read by nobody. `--json` carries every row, so the cap costs a caller nothing.
function overflow_line(rows: ReadonlyArray<LabelTotal>): Array<string> {
	if (rows.length <= MAX_ROWS) return []

	return [`  … and ${String(rows.length - MAX_ROWS)} more (--json carries them all)`]
}

function total_lines(heading: string, rows: ReadonlyArray<LabelTotal>): Array<string> {
	if (rows.length === 0) return []

	const shown = rows
		.slice(0, MAX_ROWS)
		.map((row) => format_row(row.label, row.duration_ms, `${String(row.call_count)} call(s)`))

	return ['', heading, ...shown, ...overflow_line(rows)]
}

// A table of zeroes reads as "this run took no time", which is never true. A session with no timed
// line says so in words instead — the same answer `cost_report.format_empty` gives.
function note_lines(notes: ReadonlyArray<string>): Array<string> {
	return notes.map((note) => `  ${note}`)
}

// The sentence names no particular transcript, because a run scope reaches here when no transcript
// was found at all — "this transcript has fewer" would then be about a file nobody located.
function format_empty(report: TimeReport): string {
	return [
		`${report.scope} — no timed lines`,
		...note_lines(report.notes),
		'',
		'A span needs two dated lines to sit between, and nothing read here has a pair. So there is',
		'no elapsed time to divide up.',
	].join('\n')
}

function format_report(report: TimeReport): string {
	if (report.span_count === 0 && report.categories.ci_ms === 0) return format_empty(report)

	return [
		`${report.scope} — ${format_minutes(report.elapsed_ms)} elapsed`,
		...note_lines(report.notes),
		'',
		'Where the wall clock went:',
		...category_lines(report),
		...total_lines('By tool (descending):', report.by_tool),
		...total_lines('By josh command (descending):', report.by_josh_command),
		...total_lines('By CI check (descending, jobs overlap):', report.by_check),
	].join('\n')
}

const time_report = {
	MAX_ROWS,
	build_from_spans,
	build_report,
	format_minutes,
	format_share,
	format_empty,
	format_report,
}

export type { CategoryTotals, LabelTotal, ReportInput, TimeReport }
export { time_report }
