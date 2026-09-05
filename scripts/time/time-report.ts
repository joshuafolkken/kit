import { time_bundles, type BundleTotals } from './time-bundles'
import { time_checks, type CheckTotal } from './time-checks'
import { time_ci, type CiFacts } from './time-ci'
import { time_failures, type FailureTotals } from './time-failures'
import { time_format } from './time-format'
import { time_invocations, type InvocationTotal } from './time-invocations'
import { time_phases, type PhaseTotal } from './time-phases'
import { time_round_trips } from './time-round-trips'
import { time_segments, type Segment } from './time-segments'
import { time_spans, type Span, type SpanCategory, type Timeline } from './time-spans'
import {
	time_tool_turns,
	type ToolTurnCounts,
	type TurnSplit,
	type TurnTotals,
} from './time-tool-turns'
import { time_trips } from './time-trips'

// Aggregating timed spans into the report a person reads (joshuafolkken/kit#1267).
//
// It takes spans rather than a transcript so the later children of epic #1262 can reuse it: a phase
// breakdown slices the same array by boundary, and an epic aggregation concatenates several
// sessions' arrays before calling this. Neither needs a second aggregator.

const NOT_DETECTED = 'not detected'
// The column and number formatting moved to `time-format.ts` when the failure block became a third
// renderer sharing it (joshuafolkken/kit#1309). It is re-exported below under the names it always
// had, so `time-epic-report.ts` and `time-run.ts` keep laying their rows out through one set of
// widths rather than acquiring a second.
// `MAX_ROWS` and its overflow note moved there too when the segment and per-invocation tables became
// the fourth and fifth renderers needing them (joshuafolkken/kit#1311): both are imported *by* this
// file, so neither could reach back for a cap that lived here.
const { format_minutes, format_seconds, format_share, format_columns, format_row, unmeasured_row } =
	time_format
const PHASE_HEADING = 'By phase (in run order):'
// The round-trip block moved to `time-trips.ts` when this file passed its length limit
// (joshuafolkken/kit#1385) — the shape `time-bundles.ts` and `time-failures.ts` already have, where a
// block owns its own rendering and this file calls one function per block. Its labels are re-exported
// below under the names they always had. The four category labels went to `time-format.ts` in the same
// move, because that block's price row prints one of them and cannot import this file.
const { MODEL_LABEL, TOOL_LABEL, HUMAN_LABEL, CI_LABEL, NO_CALLS } = time_format

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

// A per-tool row, which carries two counts the per-`josh <cmd>` table does not
// (joshuafolkken/kit#1385). **The two tables are deliberately different shapes here**: a `josh`
// subcommand is one `Bash` call under another name, so its round trips are already the `Bash` row's —
// printing them again would report the same trip twice under two labels in one report.
type ToolTotal = LabelTotal & ToolTurnCounts

// What every table's rows have in common, so the one renderer below lays out the per-tool totals and
// the per-check rows alike rather than acquiring a second copy of the cap, the overflow note and the
// widths (joshuafolkken/kit#1310). What differs between them is the third column, which is the
// function each caller passes.
interface RowTotal {
	label: string
	duration_ms: number
}

// `TurnSplit` is inherited rather than restated (joshuafolkken/kit#1385): `batched_turn_count` and
// `single_call_turn_count` say how the round trips below divided between the turns that issued several
// calls and the turns that issued one. The density says a run is not batching; only these say how much
// of the run that verdict rests on — over 101 round trips, 7 turns of two calls against 94 single-call
// ones and 3 turns issuing three and four calls against 98 both read 1.07, and the second run has a
// third as much batching to build on. **Withheld with the block they are printed in**
// rather than on a test of their own, so `span_count: 0` reports them unmeasured exactly as it reports
// the counts they sit beside.
interface TimeReport extends TurnSplit {
	// What was measured: `session <id>` for one session, `issue #<N>` for a whole run. A label rather
	// than a session id, because a run spans sessions and has no single one to name.
	scope: string
	started_at: string
	ended_at: string
	elapsed_ms: number
	span_count: number
	// How many model spans the run has — one per assistant turn, which is what a per-turn figure is
	// divided by (joshuafolkken/kit#1271). Carried on the report rather than recomputed by each caller,
	// because the spans are gone by the time a caller holds one: an epic aggregation reads several
	// runs' reports and has no access to the arrays they were built from.
	turn_count: number
	// How many tool calls the run made, and how many times it stopped to wait for their results
	// (joshuafolkken/kit#1304). The two differ exactly by batching: calls issued together in one turn
	// are one round trip, and a run that batches nothing has as many round trips as calls. Carried on
	// the report for the same reason `turn_count` is — the spans are gone by the time an epic
	// aggregation reads several runs' reports.
	tool_call_count: number
	round_trip_count: number
	// What one round trip cost, and how much of that was the model composing the turn that issued it
	// (joshuafolkken/kit#1307). The counts above say how often a run went round; only these say what
	// cutting one of them is worth, which is what lets the round trips be *ranked* against the slowest
	// command rather than merely noticed beside it. **Neither is a share of `elapsed_ms`** — both are
	// built from the issuing model time and the tool execution alone, so the price stays what a round
	// trip costs rather than what the run did while one was outstanding. Zero where there was no round
	// trip to divide by — the withheld answer the counts themselves give, never a measured zero.
	ms_per_round_trip: number
	model_ms_per_round_trip: number
	// How many of those round trips a run need not have made (joshuafolkken/kit#1344). The counts above
	// say how often the run went round and what one trip was worth; only this says how much of it was
	// avoidable, which is what a mechanism to prevent it would be sized against. Built by
	// `time-bundles.ts`, which also renders the block — the shape `time-failures.ts` already uses.
	bundles: BundleTotals
	categories: CategoryTotals
	// Whether the GitHub half was read at all. A session report has no pull request, so printing a
	// `CI wait 0.0 min` row there would assert a measurement nobody made.
	has_ci_data: boolean
	// Whatever the reader has to know to read the figures correctly — how many sessions contributed,
	// which pull request, an unmerged one, an issue with no pull request at all. Printed under the
	// heading rather than swallowed: an unknown is reported, never rendered as a zero.
	notes: Array<string>
	// The same elapsed time cut by workflow stage rather than by what was waited on
	// (joshuafolkken/kit#1269). Every span lands in exactly one phase and the CI share is its own, so
	// these sum to `elapsed_ms` — `other` is what keeps that true rather than being discarded.
	phases: Array<PhaseTotal>
	// The same elapsed time again, this time as the stretches it was spent in rather than as totals
	// (joshuafolkken/kit#1311). Every span lands in exactly one segment, so these sum to the three
	// transcript shares — the phase table's total without the CI share, which no span covers.
	segments: Array<Segment>
	by_tool: Array<ToolTotal>
	by_josh_command: Array<LabelTotal>
	// One row per command that was called more than once, carrying each call's own duration
	// (joshuafolkken/kit#1311). The two tables above say what a command cost in total; only this says
	// whether its calls were getting longer.
	by_invocation: Array<InvocationTotal>
	// One row per CI job, carrying what it concluded and how far its finish sat from the merge
	// (joshuafolkken/kit#1310). Built by `time-checks.ts`, which is also what renders the third column.
	by_check: Array<CheckTotal>
	// How much of the run was doing something a second time because it failed the first
	// (joshuafolkken/kit#1309). Carried on the report rather than recomputed by the renderer, because
	// the spans are gone by the time anything holds a report — and so `--json` carries the figures
	// without a second walk. **The epic scope does not aggregate it yet**: `time-epic.ts` sums the
	// categories alone, so `josh time --epic` prints no rework block.
	failures: FailureTotals
}

// Everything `build_from_spans` needs. A record rather than seven positional parameters, which the
// four-parameter limit forbids anyway and which no reader could keep in order.
interface ReportInput {
	scope: string
	spans: ReadonlyArray<Span>
	started_ms: number
	ended_ms: number
	// The CI half whole, rather than the share and its flag separately (joshuafolkken/kit#1384): the
	// phase table reads the per-commit windows as well, and three fields that must agree are three
	// fields a caller can hand over inconsistently.
	ci: CiFacts
	notes: ReadonlyArray<string>
	by_check: ReadonlyArray<CheckTotal>
}

function of_category(spans: ReadonlyArray<Span>, category: SpanCategory): Array<Span> {
	return spans.filter((span) => span.category === category)
}

function category_ms(spans: ReadonlyArray<Span>, category: SpanCategory): number {
	return of_category(spans, category).reduce((sum, span) => sum + span.duration_ms, 0)
}

// An empty label is not a bucket. Every span carries a category, but only tool spans carry a tool
// name, and only a Bash span running `pnpm josh <cmd>` carries a command — printing the rest under
// a blank row would invent a total nobody measured.
//
// **A continuation adds its duration and not a call** (joshuafolkken/kit#1304). One call bracketing a
// delegated unit comes back from `time_overlap.trim` as two spans; both intervals are real and both
// are summed, but counting both as calls reported a run as having made more than it did — and left
// this table disagreeing with the round-trip block, which counts the same calls.
function accumulate(totals: Map<string, LabelTotal>, label: string, span: Span): void {
	if (label === '') return

	const existing = totals.get(label) ?? { label, duration_ms: 0, call_count: 0 }

	totals.set(label, {
		label,
		duration_ms: existing.duration_ms + span.duration_ms,
		call_count: existing.call_count + (span.is_continuation ? 0 : 1),
	})
}

function totals_by(spans: ReadonlyArray<Span>, key_of: (span: Span) => string): Array<LabelTotal> {
	const totals = new Map<string, LabelTotal>()
	const rows: Array<LabelTotal> = []

	for (const span of spans) accumulate(totals, key_of(span), span)
	// Drained with a loop rather than a spread: `Iterator#toArray` is not in this project's TS lib,
	// and the spread form the linter would otherwise demand does not type-check.
	for (const [, row] of totals) rows.push(row)

	return rows.toSorted((left, right) => right.duration_ms - left.duration_ms)
}

function to_iso(timestamp_ms: number): string {
	return timestamp_ms === 0 ? '' : new Date(timestamp_ms).toISOString()
}

function category_totals(spans: ReadonlyArray<Span>, ci_ms: number): CategoryTotals {
	return {
		model_ms: category_ms(spans, time_spans.MODEL_CATEGORY),
		tool_ms: category_ms(spans, time_spans.TOOL_CATEGORY),
		human_ms: category_ms(spans, time_spans.HUMAN_CATEGORY),
		ci_ms,
	}
}

// The four figures a reader takes as counts rather than durations: how many spans were read, how many
// turns they sat in, how many calls went out, and how many times the run stopped for them. Grouped
// because the last two are one question asked at two grains, and the first two are what the report
// already divided per-turn figures by.
function span_counts(
	spans: ReadonlyArray<Span>,
): Pick<TimeReport, 'span_count' | 'turn_count' | 'tool_call_count' | 'round_trip_count'> {
	return {
		span_count: spans.length,
		turn_count: of_category(spans, time_spans.MODEL_CATEGORY).length,
		tool_call_count: time_round_trips.count_calls(spans),
		round_trip_count: time_round_trips.count_round_trips(spans),
	}
}

// **The price of one round trip — the half that turns the count into a saving one can rank**
// (joshuafolkken/kit#1307). **The numerator is what a round trip is made of, not the run's whole
// elapsed time**: the model time of the turns that issued the trips, plus the tool execution they
// waited on. Human wait and CI wait are in neither, because a round trip does not cause them and a
// price that folded them in would be multiplied out as a saving and then counted a second time
// against the `wait` and `ci` rows of the very table it was carried into.
function per_round_trip_costs(
	spans: ReadonlyArray<Span>,
	tool_ms: number,
	round_trip_count: number,
): Pick<TimeReport, 'ms_per_round_trip' | 'model_ms_per_round_trip'> {
	const model_ms = time_round_trips.issuing_model_ms(spans)

	return {
		ms_per_round_trip: time_round_trips.per_round_trip(model_ms + tool_ms, round_trip_count),
		model_ms_per_round_trip: time_round_trips.per_round_trip(model_ms, round_trip_count),
	}
}

// The six tables a report carries beside its totals. Grouped into one builder so `build_from_spans`
// stays a list of the run's own figures — every one of these is a walk of the same spans that another
// module owns, and only `by_tool` needs anything the totals computed.
type ReportTables = Pick<
	TimeReport,
	'phases' | 'segments' | 'by_tool' | 'by_josh_command' | 'by_invocation' | 'by_check'
>

function report_tables(input: ReportInput, turns: TurnTotals): ReportTables {
	const { spans } = input

	return {
		phases: time_phases.build_phases({ spans, ci: input.ci }),
		segments: time_segments.build_segments(spans),
		by_tool: time_tool_turns.with_turn_counts(
			totals_by(spans, (span) => span.label),
			turns.by_label,
		),
		by_josh_command: totals_by(spans, (span) => span.josh_command),
		by_invocation: time_invocations.build_invocations(spans),
		by_check: [...input.by_check],
	}
}

// **Elapsed is the sum of the four shares, not the window's length.** For one session the two are
// the same, because its spans tile its window exactly. For a run they are not: two sessions with a
// day between them leave real time that belonged to nobody, and counting it as elapsed would report
// a run as a day long. So the header states what was accounted for, and `started_at` / `ended_at`
// still carry the wall window a reader can check it against.
function build_from_spans(input: ReportInput): TimeReport {
	const { spans, ci } = input
	const categories = category_totals(spans, ci.ci_ms)
	const elapsed_ms = categories.model_ms + categories.tool_ms + categories.human_ms + ci.ci_ms
	const counts = span_counts(spans)
	const turns = time_tool_turns.build_turns(spans)

	return {
		scope: input.scope,
		started_at: to_iso(input.started_ms),
		ended_at: to_iso(input.ended_ms),
		elapsed_ms,
		...counts,
		...turns.split,
		...per_round_trip_costs(spans, categories.tool_ms, counts.round_trip_count),
		bundles: time_bundles.build_bundles(spans),
		categories,
		has_ci_data: ci.has_ci_data,
		notes: [...input.notes],
		...report_tables(input, turns),
		failures: time_failures.build_failures(spans),
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
		ci: time_ci.NO_CI,
		notes: [],
		by_check: [],
	})
}

// **A phase whose marker never appeared says so rather than printing `0.0 min`.** "Did not run" and
// "this transcript could not be read for it" are different answers, and a measured zero asserts the
// first when only the second may be true. The words go in the share column with the duration column
// left empty, because there is no duration — not a short one.
function phase_line(phase: PhaseTotal, elapsed_ms: number): string {
	if (!phase.is_detected) return format_columns(phase.phase, '', NOT_DETECTED)

	return format_row(phase.phase, phase.duration_ms, format_share(phase.duration_ms, elapsed_ms))
}

function phase_lines(report: TimeReport): Array<string> {
	if (report.phases.length === 0) return []

	return ['', PHASE_HEADING, ...report.phases.map((phase) => phase_line(phase, report.elapsed_ms))]
}

function ci_line(report: TimeReport): Array<string> {
	if (!report.has_ci_data) return []

	const { ci_ms } = report.categories

	return [format_row(CI_LABEL, ci_ms, format_share(ci_ms, report.elapsed_ms))]
}

// **The three transcript shares are withheld together when no span was read** (joshuafolkken/kit#1295).
// A run whose transcript could not be attributed totals zero in all three because nothing was read,
// not because nothing happened — and `CI wait 3.2 min 100.0%` directly beneath three `0.0 min` rows
// reads as a run that spent its whole length in CI. The criterion is `time_spans.has_transcript_data`,
// the same one the epic scope withholds its own category rows on and the `wait` phase is detected on.
function transcript_row(report: TimeReport, label: string, duration_ms: number): string {
	if (!time_spans.has_transcript_data(report.span_count)) return unmeasured_row(label)

	return format_row(label, duration_ms, format_share(duration_ms, report.elapsed_ms))
}

function category_lines(report: TimeReport): Array<string> {
	const { categories } = report

	return [
		transcript_row(report, MODEL_LABEL, categories.model_ms),
		transcript_row(report, TOOL_LABEL, categories.tool_ms),
		transcript_row(report, HUMAN_LABEL, categories.human_ms),
		...ci_line(report),
	]
}

// What the per-tool and per-`josh <cmd>` tables put in their third column: how many calls the row
// totals. The check table answers something else entirely, which is why the column is a parameter.
function call_suffix(row: LabelTotal): string {
	return `${String(row.call_count)} call(s)`
}

// **What the per-tool table says that the per-`josh <cmd>` table does not** (joshuafolkken/kit#1385):
// the round trips this tool consumed, and how many of its calls were the only call in their turn. A
// row reading `40 call(s) · 40 round trip(s) · 40 alone` names the tool to batch, which is the sentence
// the density one block above could never produce.
function tool_suffix(row: ToolTotal): string {
	const trips = `${String(row.round_trip_count)} round trip(s)`
	const alone = `${String(row.alone_in_turn_count)} alone`

	return [call_suffix(row), trips, alone].join(time_format.SUFFIX_SEPARATOR)
}

function total_lines<Row extends RowTotal>(
	heading: string,
	rows: ReadonlyArray<Row>,
	suffix_of: (row: Row) => string,
): Array<string> {
	if (rows.length === 0) return []

	const shown = rows
		.slice(0, time_format.MAX_ROWS)
		.map((row) => format_row(row.label, row.duration_ms, suffix_of(row)))

	return ['', heading, ...shown, ...time_format.overflow_line(rows.length)]
}

// The sentence names no particular transcript, because a run scope reaches here when no transcript
// was found at all — "this transcript has fewer" would then be about a file nobody located.
function format_empty(report: TimeReport): string {
	return [
		`${report.scope} — no timed lines`,
		...time_format.note_lines(report.notes),
		'',
		'A span needs two dated lines to sit between, and nothing read here has a pair. So there is',
		'no elapsed time to divide up.',
	].join('\n')
}

function format_report(report: TimeReport): string {
	if (report.span_count === 0 && report.categories.ci_ms === 0) return format_empty(report)

	return [
		`${report.scope} — ${format_minutes(report.elapsed_ms)} elapsed`,
		...time_format.note_lines(report.notes),
		'',
		'Where the wall clock went:',
		...category_lines(report),
		...phase_lines(report),
		...time_segments.segment_lines(report.segments),
		...time_trips.trip_lines(report),
		...time_bundles.bundle_lines(report.bundles, report),
		...time_failures.failure_lines(
			report.failures,
			report.tool_call_count,
			report.categories.tool_ms,
		),
		...total_lines('By tool (descending):', report.by_tool, tool_suffix),
		...total_lines('By josh command (descending):', report.by_josh_command, call_suffix),
		...time_invocations.invocation_lines(report.by_invocation),
		...total_lines(time_checks.CHECK_HEADING, report.by_check, time_checks.check_suffix),
		...time_checks.merge_wait_lines(report.by_check),
	].join('\n')
}

const time_report = {
	MAX_ROWS: time_format.MAX_ROWS,
	NOT_DETECTED,
	NOT_MEASURED: time_format.NOT_MEASURED,
	PHASE_HEADING,
	// The round-trip block's own names, re-exported so every caller keeps asking one namespace after
	// the block moved to `time-trips.ts` (joshuafolkken/kit#1385).
	ROUND_TRIP_HEADING: time_trips.HEADING,
	CALLS_LABEL: time_trips.CALLS_LABEL,
	TRIPS_LABEL: time_trips.TRIPS_LABEL,
	BATCHED_TURNS_LABEL: time_trips.BATCHED_TURNS_LABEL,
	COST_LABEL: time_trips.COST_LABEL,
	PER_ROUND_TRIP: time_trips.PER_ROUND_TRIP,
	NO_CALLS,
	BATCHING_WARNING: time_trips.BATCHING_WARNING,
	MODEL_LABEL,
	TOOL_LABEL,
	HUMAN_LABEL,
	CI_LABEL,
	build_from_spans,
	build_report,
	format_minutes,
	format_seconds,
	format_share,
	// Exported so the epic aggregation lays its rows out through this same function rather than a
	// second copy of the widths: two column rules would drift apart the first time one of them changed.
	format_columns,
	format_row,
	unmeasured_row,
	format_empty,
	format_report,
}

export type { CategoryTotals, LabelTotal, ReportInput, TimeReport, ToolTotal }
export { time_report }
