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

interface CategoryTotals {
	model_ms: number
	tool_ms: number
	human_ms: number
}

interface LabelTotal {
	label: string
	duration_ms: number
	call_count: number
}

interface TimeReport {
	session_id: string
	started_at: string
	ended_at: string
	elapsed_ms: number
	span_count: number
	categories: CategoryTotals
	by_tool: Array<LabelTotal>
	by_josh_command: Array<LabelTotal>
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

function build_report(session_id: string, timeline: Timeline): TimeReport {
	const { spans } = timeline

	return {
		session_id,
		started_at: to_iso(timeline.started_ms),
		ended_at: to_iso(timeline.ended_ms),
		elapsed_ms: timeline.ended_ms - timeline.started_ms,
		span_count: spans.length,
		categories: {
			model_ms: category_ms(spans, time_spans.MODEL_CATEGORY),
			tool_ms: category_ms(spans, time_spans.TOOL_CATEGORY),
			human_ms: category_ms(spans, time_spans.HUMAN_CATEGORY),
		},
		by_tool: totals_by(spans, (span) => span.label),
		by_josh_command: totals_by(spans, (span) => span.josh_command),
	}
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

function category_lines(report: TimeReport): Array<string> {
	const { categories, elapsed_ms } = report

	return [
		format_row('model wait', categories.model_ms, format_share(categories.model_ms, elapsed_ms)),
		format_row('tool execution', categories.tool_ms, format_share(categories.tool_ms, elapsed_ms)),
		format_row('human wait', categories.human_ms, format_share(categories.human_ms, elapsed_ms)),
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
function format_empty(report: TimeReport): string {
	return [
		`session ${report.session_id} — no timed lines`,
		'',
		'A span needs two dated lines to sit between. This transcript has fewer, so there is no',
		'elapsed time to divide up.',
	].join('\n')
}

function format_report(report: TimeReport): string {
	if (report.span_count === 0) return format_empty(report)

	return [
		`session ${report.session_id} — ${format_minutes(report.elapsed_ms)} elapsed`,
		'',
		'Where the wall clock went:',
		...category_lines(report),
		...total_lines('By tool (descending):', report.by_tool),
		...total_lines('By josh command (descending):', report.by_josh_command),
	].join('\n')
}

const time_report = {
	MAX_ROWS,
	build_report,
	format_minutes,
	format_share,
	format_empty,
	format_report,
}

export type { CategoryTotals, LabelTotal, TimeReport }
export { time_report }
