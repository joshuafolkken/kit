import { time_checks, type CheckTotal } from './time-checks'
import { time_failures, type FailureTotals } from './time-failures'
import { time_format } from './time-format'
import { time_phases, type PhaseTotal } from './time-phases'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span, type SpanCategory, type Timeline } from './time-spans'

// Aggregating timed spans into the report a person reads (joshuafolkken/kit#1267).
//
// It takes spans rather than a transcript so the later children of epic #1262 can reuse it: a phase
// breakdown slices the same array by boundary, and an epic aggregation concatenates several
// sessions' arrays before calling this. Neither needs a second aggregator.

const MAX_ROWS = 15
const NOT_DETECTED = 'not detected'
// The column and number formatting moved to `time-format.ts` when the failure block became a third
// renderer sharing it (joshuafolkken/kit#1309). It is re-exported below under the names it always
// had, so `time-epic-report.ts` and `time-run.ts` keep laying their rows out through one set of
// widths rather than acquiring a second.
const { format_minutes, format_seconds, format_share, format_columns, format_row, unmeasured_row } =
	time_format
const PHASE_HEADING = 'By phase (in run order):'
const ROUND_TRIP_HEADING = 'Round trips:'
const CALLS_LABEL = 'tool calls'
const TRIPS_LABEL = 'round trips'
// What one of those trips cost. The label says `cost` rather than `elapsed` because the row is read
// as a unit price — the thing a proposed cut is multiplied by (joshuafolkken/kit#1307).
const COST_LABEL = 'cost per round trip'
// The unit the density and its floor are both quoted in, written once so the row and the warning
// beneath it cannot come to name it differently.
const PER_ROUND_TRIP = 'calls per round trip'
// What the trips row says instead of a density when there were no round trips to divide by.
const NO_CALLS = 'no tool call to divide'
const NO_DENSITY = 0
// The one sentence the threshold exists to produce. It names what is not happening rather than the
// number, because the number is already in the row above it.
const BATCHING_WARNING = 'independent calls are going out one per turn'
// The category labels, shared with the epic scope's table rather than spelled out in each. The two
// tables answer the same question at two scales, so a label renamed in one and not the other is a
// report that disagrees with itself — which is the defect joshuafolkken/kit#1295 was filed for.
const MODEL_LABEL = 'model wait'
const TOOL_LABEL = 'tool execution'
const HUMAN_LABEL = 'human wait'
const CI_LABEL = 'CI wait'

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

// What every table's rows have in common, so the one renderer below lays out the per-tool totals and
// the per-check rows alike rather than acquiring a second copy of the cap, the overflow note and the
// widths (joshuafolkken/kit#1310). What differs between them is the third column, which is the
// function each caller passes.
interface RowTotal {
	label: string
	duration_ms: number
}

interface TimeReport {
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
	by_tool: Array<LabelTotal>
	by_josh_command: Array<LabelTotal>
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
	ci_ms: number
	has_ci_data: boolean
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

// **Elapsed is the sum of the four shares, not the window's length.** For one session the two are
// the same, because its spans tile its window exactly. For a run they are not: two sessions with a
// day between them leave real time that belonged to nobody, and counting it as elapsed would report
// a run as a day long. So the header states what was accounted for, and `started_at` / `ended_at`
// still carry the wall window a reader can check it against.
function build_from_spans(input: ReportInput): TimeReport {
	const { spans, ci_ms, has_ci_data } = input
	const categories = category_totals(spans, ci_ms)
	const elapsed_ms = categories.model_ms + categories.tool_ms + categories.human_ms + ci_ms
	const counts = span_counts(spans)

	return {
		scope: input.scope,
		started_at: to_iso(input.started_ms),
		ended_at: to_iso(input.ended_ms),
		elapsed_ms,
		...counts,
		...per_round_trip_costs(spans, categories.tool_ms, counts.round_trip_count),
		categories,
		has_ci_data,
		notes: [...input.notes],
		phases: time_phases.build_phases({ spans, ci_ms, has_ci_data }),
		by_tool: totals_by(spans, (span) => span.label),
		by_josh_command: totals_by(spans, (span) => span.josh_command),
		by_check: [...input.by_check],
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
		ci_ms: 0,
		has_ci_data: false,
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

// The threshold's whole output. Printed only when the density is under the floor, because a run that
// batches has nothing to say here and a line that appears every time is one nobody reads.
function batching_warning_lines(density: number): Array<string> {
	if (!time_round_trips.is_below_floor(density)) return []

	const floor = time_round_trips.format_density(time_round_trips.CALLS_PER_ROUND_TRIP_FLOOR)

	return [`  ⚠ ${BATCHING_WARNING} (floor ${floor} ${PER_ROUND_TRIP})`]
}

// **A transcript that was read but called no tool has no density, and says so.** The division
// answers `0` there, which is the same value an unread transcript produces — printing it as
// `0.00 calls per round trip` would report the worst possible batching for a scope that did no
// batching to grade.
function density_text(density: number): string {
	if (density === NO_DENSITY) return NO_CALLS

	return `${time_round_trips.format_density(density)} ${PER_ROUND_TRIP}`
}

// **A count nobody priced cannot be ranked** (joshuafolkken/kit#1307). Forty round trips is a
// number; forty at twelve seconds each is eight minutes, which is what a proposed cut is weighed
// against the slowest command with. The model share rides in the suffix because it is the part
// batching actually removes — a tool's own execution is paid whichever turn it is issued from.
//
// **Withheld on the density, not on a second test of its own.** A density of zero means there was no
// round trip to divide by, so the unit price has nothing behind it either — deciding that twice would
// let the two rows come to disagree about what was measured.
function cost_line(report: TimeReport, density: number): string {
	if (density === NO_DENSITY) return format_columns(COST_LABEL, '', NO_CALLS)

	const model_cost = `${MODEL_LABEL} ${format_seconds(report.model_ms_per_round_trip)}`

	return format_columns(COST_LABEL, format_seconds(report.ms_per_round_trip), model_cost)
}

function measured_round_trip_lines(report: TimeReport): Array<string> {
	const { tool_call_count, round_trip_count, turn_count } = report
	const density = time_round_trips.per_round_trip(tool_call_count, round_trip_count)

	return [
		format_columns(CALLS_LABEL, String(tool_call_count), `over ${String(turn_count)} turn(s)`),
		format_columns(TRIPS_LABEL, String(round_trip_count), density_text(density)),
		cost_line(report, density),
		...batching_warning_lines(density),
	]
}

// **A run whose transcript was not read has no round trips to report, and says so** — the same
// answer, on the same criterion, that the three category shares already give. A count of `0` here
// would read as a run that called no tool at all, which is never true of a run that merged.
function round_trip_lines(report: TimeReport): Array<string> {
	const heading = ['', ROUND_TRIP_HEADING]

	if (!time_spans.has_transcript_data(report.span_count)) {
		const rows = [CALLS_LABEL, TRIPS_LABEL, COST_LABEL].map((label) => unmeasured_row(label))

		return [...heading, ...rows]
	}

	return [...heading, ...measured_round_trip_lines(report)]
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

// Capped, because a long run touches thirty-odd distinct leading commands and a table that long is
// read by nobody. `--json` carries every row this report holds, so the display cap costs a caller
// nothing.
//
// **The parenthetical says "this report" rather than "them all"** (joshuafolkken/kit#1301): since
// `--top` can cut the record itself before either rendering, a promise that `--json` carries every
// row *there ever was* would be false beside a `--top` above this display cap — and the report would
// then contradict its own truncation note. What was cut from the record, if anything, is said in
// `notes`; what is cut from this table is said here.
function overflow_line(row_count: number): Array<string> {
	if (row_count <= MAX_ROWS) return []

	return [
		`  … and ${String(row_count - MAX_ROWS)} more (--json carries every row this report holds)`,
	]
}

// What the per-tool and per-`josh <cmd>` tables put in their third column: how many calls the row
// totals. The check table answers something else entirely, which is why the column is a parameter.
function call_suffix(row: LabelTotal): string {
	return `${String(row.call_count)} call(s)`
}

function total_lines<Row extends RowTotal>(
	heading: string,
	rows: ReadonlyArray<Row>,
	suffix_of: (row: Row) => string,
): Array<string> {
	if (rows.length === 0) return []

	const shown = rows
		.slice(0, MAX_ROWS)
		.map((row) => format_row(row.label, row.duration_ms, suffix_of(row)))

	return ['', heading, ...shown, ...overflow_line(rows.length)]
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
		...phase_lines(report),
		...round_trip_lines(report),
		...time_failures.failure_lines(
			report.failures,
			report.tool_call_count,
			report.categories.tool_ms,
		),
		...total_lines('By tool (descending):', report.by_tool, call_suffix),
		...total_lines('By josh command (descending):', report.by_josh_command, call_suffix),
		...total_lines(time_checks.CHECK_HEADING, report.by_check, time_checks.check_suffix),
		...time_checks.merge_wait_lines(report.by_check),
	].join('\n')
}

const time_report = {
	MAX_ROWS,
	NOT_DETECTED,
	NOT_MEASURED: time_format.NOT_MEASURED,
	PHASE_HEADING,
	ROUND_TRIP_HEADING,
	CALLS_LABEL,
	TRIPS_LABEL,
	COST_LABEL,
	PER_ROUND_TRIP,
	NO_CALLS,
	BATCHING_WARNING,
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

export type { CategoryTotals, LabelTotal, ReportInput, TimeReport }
export { time_report }
