import { time_bundles, type BundleTotals } from './time-bundles'
import { time_category_table, type CategoryTotals } from './time-category-table'
import type { CheckTotal } from './time-checks'
import { time_ci, type CiFacts } from './time-ci'
import { time_cycles, type CycleTotals } from './time-cycles'
import { time_failures, type FailureTotals } from './time-failures'
import { time_followup_stages, type FollowupStageTotals } from './time-followup-stages'
import { time_format } from './time-format'
import { time_gaps, type GapTotals } from './time-gaps'
import { time_gate_runs, type GateRunTotals } from './time-gate-runs'
import { time_investigation, type InvestigationTotals } from './time-investigation'
import { time_invocations, type InvocationTotal } from './time-invocations'
import { time_josh_commands } from './time-josh-commands'
import { time_model_gaps } from './time-model-gaps'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'
import { time_phase_costs, type PhaseCostFacts } from './time-phase-costs'
import { time_phase_table } from './time-phase-table'
import { time_phases, type PhaseTotal } from './time-phases'
import { time_ranked_tables } from './time-ranked-tables'
import { time_rework, type DiffFacts, type ReworkTotals } from './time-rework'
import { time_round_trips } from './time-round-trips'
import { time_segments, type Segment } from './time-segments'
import { time_single_checks, type SingleCheckTotals } from './time-single-checks'
import { time_spans, type Span, type SpanCategory, type Timeline } from './time-spans'
import {
	time_tool_turns,
	type ToolTurnCounts,
	type TurnSplit,
	type TurnTotals,
} from './time-tool-turns'
import { time_trips } from './time-trips'
import { time_windows, type RunWindows } from './time-windows'

// Aggregating timed spans into the report a person reads (joshuafolkken/kit#1267).
//
// It takes spans rather than a transcript so the later children of epic #1262 can reuse it: a phase
// breakdown slices the same array by boundary, and an epic aggregation concatenates several
// sessions' arrays before calling this. Neither needs a second aggregator.

// The column and number formatting moved to `time-format.ts` when the failure block became a third
// renderer sharing it (joshuafolkken/kit#1309). It is re-exported below under the names it always
// had, so `time-epic-report.ts` and `time-run.ts` keep laying their rows out through one set of
// widths rather than acquiring a second.
// `MAX_ROWS` and its overflow note moved there too when the segment and per-invocation tables became
// the fourth and fifth renderers needing them (joshuafolkken/kit#1311): both are imported *by* this
// file, so neither could reach back for a cap that lived here.
const { format_minutes, format_seconds, format_share, format_columns, format_row, unmeasured_row } =
	time_format
// The phase block moved to `time-phase-table.ts` when its withheld footnote would not fit inside this
// file's remaining code lines (joshuafolkken/kit#1392) — the same move, for the same reason, as the
// round-trip block below. Its heading and its `not detected` wording are re-exported at the bottom
// under the names they always had.
// The round-trip block moved to `time-trips.ts` when this file passed its length limit
// (joshuafolkken/kit#1385) — the shape `time-bundles.ts` and `time-failures.ts` already have, where a
// block owns its own rendering and this file calls one function per block. Its labels are re-exported
// below under the names they always had. The four category labels went to `time-format.ts` in the same
// move, because that block's price row prints one of them and cannot import this file.
const { MODEL_LABEL, TOOL_LABEL, HUMAN_LABEL, CI_LABEL, NO_CALLS } = time_format

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
// ones and 3 turns issuing three and four calls against 98 both read 1.07, and the second run has
// less than half as much batching to build on. **Withheld with the block they are printed in**
// rather than on a test of their own, so `span_count: 0` reports them unmeasured exactly as it reports
// the counts they sit beside.
interface TimeReport extends TurnSplit {
	// What was measured: `session <id>` for one session, `issue #<N>` for a whole run. A label rather
	// than a session id, because a run spans sessions and has no single one to name.
	scope: string
	started_at: string
	ended_at: string
	elapsed_ms: number
	// The same wall clock as the pair above, plus the two windows it nests inside: the pull request's
	// open→merged and the issue's opened→closed (joshuafolkken/kit#1409). The pair above says when the
	// run ran; only these say which of the three a proposal to cut minutes is a proposal about. Each
	// window carries its own `is_read`, so a scope with no pull request or no issue withholds that row
	// rather than printing a measured zero. Built and rendered by `time-windows.ts`, which also carries
	// why these are not the `pre-run` / `post-run` phases.
	windows: RunWindows
	span_count: number
	// **How many assistant messages the run's model spans came from**, which is what a per-turn figure
	// is divided by (joshuafolkken/kit#1271). Carried on the report rather than recomputed by each
	// caller, because the spans are gone by the time a caller holds one: an epic aggregation reads
	// several runs' reports and has no access to the arrays they were built from.
	//
	// **Not the number of model spans, which is what it used to be** (joshuafolkken/kit#1406). Claude
	// Code writes one transcript line per content block and repeats the message id on each, so one turn
	// is as many model spans as it wrote blocks — run #1399's 41 turns were reported as 79. The
	// definition lives in `time-round-trips.ts` beside the round trip's, since the two are the same
	// question asked at two grains.
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
	// What each phase cost and what one round trip cost in dollars (joshuafolkken/kit#1606). **An
	// optional key rather than a zeroed record**, because only the run scopes read the cost corpus:
	// absent here means the question was never asked, while a present record with `is_measured: false`
	// means it was asked and the corpus could not answer.
	phase_costs?: PhaseCostFacts
	// The same model wait as `model_ms_per_round_trip`, as the spread it was a mean of
	// (joshuafolkken/kit#1386). The mean above says what a trip cost typically; only this says whether
	// a run was slow everywhere or slow once — and the two need opposite fixes, since batching removes
	// many small trips and touches one long think not at all. Built by `time-gaps.ts`, which also
	// renders the block — the shape `time-bundles.ts` and `time-failures.ts` already have.
	gaps: GapTotals
	// How many of those round trips a run need not have made (joshuafolkken/kit#1344). The counts above
	// say how often the run went round and what one trip was worth; only this says how much of it was
	// avoidable, which is what a mechanism to prevent it would be sized against. Built by
	// `time-bundles.ts`, which also renders the block — the shape `time-failures.ts` already uses.
	bundles: BundleTotals
	// How much of the run went on re-verifying file by file between edits (joshuafolkken/kit#1383).
	// The block above says how many round trips were avoidable; only this says how many of them asked a
	// question whose answer the run already had. Built by `time-single-checks.ts`, which also renders
	// the block — the shape `time-bundles.ts` and `time-failures.ts` already have.
	single_checks: SingleCheckTotals
	// How many times the run started the whole gate, against what the procedure allows
	// (joshuafolkken/kit#1786). The block above counts the single checks the one-gate-per-run rule
	// sends an implementation loop to; this counts the gates themselves, which is the half of
	// joshuafolkken/kit#1246 nothing has ever measured. Built by `time-gate-runs.ts`, which also
	// renders the block — the shape `time-single-checks.ts` and `time-failures.ts` already have.
	gate_runs: GateRunTotals
	// What the run's turns were spent *on*, rather than how long they took (joshuafolkken/kit#1715).
	// The round-trip block says how often the run stopped and the bundling block how many of those
	// stops were avoidable; only this says what the stops were for — which is the whole question about
	// a `backlogrun` parent, since it barely implements anything. Built by `time-parent-turns.ts`,
	// which also renders the block — the shape `time-bundles.ts` and `time-single-checks.ts` have.
	parent_turns: ParentTurnTotals
	// What the largest of those contributors was actually reading (joshuafolkken/kit#1764). The block
	// above measured `investigation` at 35.9% of nineteen runs' turns and could not say how much of it
	// is the reading §2b keeps in the main line on purpose; only this separates that from the reading
	// the delegation threshold was meant to catch and did not. Built by `time-investigation.ts`, which
	// also renders the block and takes its classification from the guard itself.
	investigation: InvestigationTotals
	// How long each of `followup`'s own stages took (joshuafolkken/kit#1445). The command prints the
	// rows itself; only this keeps them past the run that printed them, which is what lets two runs be
	// compared stage by stage. Built by `time-followup-stages.ts`, which also renders the block.
	followup_stages: FollowupStageTotals
	// Which of the run's edits never reached the merged diff, and how large that diff was
	// (joshuafolkken/kit#1387). The blocks above measure how a run spent its turns; only this says how
	// much of the work was thrown away, and how much change the elapsed time bought — without which two
	// runs' minutes cannot be compared at all. Built by `time-rework.ts`, which also renders the block.
	rework: ReworkTotals
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
	// The `ci` phase one cycle at a time, each saying how much of it went on the wall clock and what
	// the rest of it hid behind (joshuafolkken/kit#1465). The phase above is the whole wait; only this
	// separates a cycle that ran behind the second review round — costing nothing — from one the run
	// sat through. Built by `time-cycles.ts`, which also renders the block.
	ci_cycles: CycleTotals
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
	// The merged diff, whole rather than as a file list and a flag: a refused read and a pull request
	// that changed nothing are two answers, and two fields that must agree are two a caller can hand
	// over inconsistently (joshuafolkken/kit#1387).
	diff: DiffFacts
	// The three nested windows, built by the caller (joshuafolkken/kit#1409). **Not derived from
	// `started_ms` / `ended_ms` above**: that pair bounds everything either source knows about — the
	// pull request's own stamps included — so a run body taken from it would be a window nobody
	// measured wherever the transcript was missing.
	windows: RunWindows
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
// **A continuation adds neither a call nor a duration** (joshuafolkken/kit#1304, joshuafolkken/kit#1591).
// One call bracketing a delegated unit comes back from `time_overlap.trim` as two spans, and counting
// both as calls reported a run as having made more than it did — leaving this table disagreeing with
// the round-trip block, which counts the same calls. Its duration is skipped for the same reason it is
// counted once: the head already carries the whole call in `own_duration_ms`, so adding the tail's
// share on top would price one call twice.
//
// **This is a per-call table, so it reports what the call took** — `own_duration_ms`, which the
// delegated subtraction never touches. The share of the run's wall clock is `duration_ms`, and that
// is what the categories, the phases and the segments go on reading, because those have to
// reconstruct `elapsed_ms` and this table does not.
function accumulate(totals: Map<string, LabelTotal>, label: string, span: Span): void {
	if (label === '' || span.is_continuation) return

	const existing = totals.get(label) ?? { label, duration_ms: 0, call_count: 0 }

	totals.set(label, {
		label,
		duration_ms: existing.duration_ms + span.own_duration_ms,
		call_count: existing.call_count + 1,
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
		turn_count: time_round_trips.count_turns(spans),
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
	const model_ms = time_model_gaps.issuing_model_ms(spans)

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
	'phases' | 'ci_cycles' | 'segments' | 'by_tool' | 'by_josh_command' | 'by_invocation' | 'by_check'
>

// The tables plus the one walk that is not a table (joshuafolkken/kit#1715). `parent_turns` is built
// here rather than beside the totals because `build_from_spans` is at its length limit, and a line of
// its own there would cost the next block the room this one took.
type ReportWalks = ReportTables & Pick<TimeReport, 'parent_turns'>

function report_tables(input: ReportInput, turns: TurnTotals): ReportWalks {
	const { spans } = input
	// The two josh-keyed tables count every command a chain ran; every other table reads the raw spans
	// (joshuafolkken/kit#1883).
	const josh_spans = time_josh_commands.with_chained(spans)

	return {
		parent_turns: time_parent_turns.build_parent_turns(spans),
		phases: time_phases.build_phases({ spans, ci: input.ci }),
		ci_cycles: time_cycles.build_cycles(spans, input.ci),
		segments: time_segments.build_segments(spans),
		by_tool: time_tool_turns.with_turn_counts(
			totals_by(spans, (span) => span.label),
			turns.by_label,
		),
		by_josh_command: totals_by(josh_spans, (span) => span.josh_command),
		by_invocation: time_invocations.build_invocations(josh_spans),
		by_check: [...input.by_check],
	}
}

// **Elapsed is the sum of the four shares, not the window's length.** For one session the two are
// the same, because its spans tile its window exactly. For a run they are not: two sessions with a
// day between them leave real time that belonged to nobody, and counting it as elapsed would report
// a run as a day long. So the header states what was accounted for, and `started_at` / `ended_at`
// still carry the wall window a reader can check it against.
// The blocks built straight off the spans, gathered into one spread so the assembly below stays
// inside its length limit as blocks are added (joshuafolkken/kit#1786 was the one that passed it).
// It is the shape `report_tables` already has, and the grouping is the honest one: every member takes
// the spans and nothing else.
type SpanBlocks = Pick<
	TimeReport,
	'gaps' | 'bundles' | 'single_checks' | 'gate_runs' | 'investigation' | 'followup_stages'
>

function span_blocks(spans: ReadonlyArray<Span>): SpanBlocks {
	return {
		gaps: time_gaps.build_gaps(spans),
		investigation: time_investigation.build_investigation(spans),
		bundles: time_bundles.build_bundles(spans),
		single_checks: time_single_checks.build_single_checks(spans),
		gate_runs: time_gate_runs.build_gate_runs(spans),
		followup_stages: time_followup_stages.build_followup_stages(spans),
	}
}

function build_from_spans(input: ReportInput): TimeReport {
	const { spans, ci } = input
	const categories = category_totals(spans, ci.ci_ms)
	const elapsed_ms = categories.model_ms + categories.tool_ms + categories.human_ms + ci.ci_ms
	const counts = span_counts(spans)
	const turns = time_tool_turns.build_turns(spans)

	return {
		scope: input.scope,
		...time_windows.build_stamps(input.started_ms, input.ended_ms, input.windows),
		elapsed_ms,
		...counts,
		...turns.split,
		...per_round_trip_costs(spans, categories.tool_ms, counts.round_trip_count),
		...span_blocks(spans),
		rework: time_rework.build_rework(spans, input.diff),
		categories,
		has_ci_data: ci.has_ci_data,
		notes: [...input.notes],
		...report_tables(input, turns),
		failures: time_failures.build_failures(spans),
	}
}

// One session, which is the shape `josh time --session` reports. It has no GitHub half, so the CI
// share is zero and the row is withheld rather than printed as a measured zero.
// **`notes` is a parameter because a session report can now be short of a transcript**
// (joshuafolkken/kit#1439): naming one unit reads the session that delegated it too, and that
// transcript can fail to read. Defaulted, so every existing caller is unchanged.
function build_report(
	session_id: string,
	timeline: Timeline,
	notes: ReadonlyArray<string> = [],
): TimeReport {
	return build_from_spans({
		scope: `session ${session_id}`,
		spans: timeline.spans,
		started_ms: timeline.started_ms,
		ended_ms: timeline.ended_ms,
		ci: time_ci.NO_CI,
		diff: time_rework.NO_DIFF,
		windows: time_windows.build_windows(
			timeline.started_ms,
			timeline.ended_ms,
			time_windows.NO_OUTER_WINDOWS,
		),
		notes,
		by_check: [],
	})
}

// The sentence names no particular transcript, because a run scope reaches here when no transcript
// was found at all — "this transcript has fewer" would then be about a file nobody located.
// What sits under the scope line in every report: the notes that qualify the figures, then the three
// windows those figures are lengths inside of.
function heading_lines(report: TimeReport): Array<string> {
	return [...time_format.note_lines(report.notes), ...time_windows.window_lines(report.windows)]
}

function format_empty(report: TimeReport): string {
	return [
		`${report.scope} — no timed lines`,
		// The windows are printed here too: an issue nobody worked on in this checkout can still have
		// been filed and closed, and that is a measurement even where no span was read.
		...heading_lines(report),
		'',
		'A span needs two dated lines to sit between, and nothing read here has a pair. So there is',
		'no elapsed time to divide up.',
	].join('\n')
}

// **The blocks that say what the run did with its turns, gathered into one function** so the page
// below stays inside its length limit as blocks are added (joshuafolkken/kit#1764 was the one that
// passed it). It is the seam `span_blocks` was cut along, applied to the rendering: the order is
// unchanged, and the failure block's three arguments are still read off the report before the list
// rather than inside it (joshuafolkken/kit#1387).
function turn_blocks(report: TimeReport): Array<string> {
	const { failures, tool_call_count, categories } = report

	return [
		...time_parent_turns.parent_turn_lines(report.parent_turns),
		...time_investigation.investigation_lines(report.investigation),
		...time_followup_stages.followup_stage_lines(report.followup_stages),
		...time_failures.failure_lines(failures, tool_call_count, categories.tool_ms),
		...time_rework.rework_lines(report.rework),
	]
}

// Each block below is one line, and the page is the order of those lines.
function format_report(report: TimeReport): string {
	if (report.span_count === 0 && report.categories.ci_ms === 0) return format_empty(report)

	return [
		`${report.scope} — ${format_minutes(report.elapsed_ms)} elapsed`,
		...heading_lines(report),
		'',
		'Where the wall clock went:',
		...time_category_table.category_lines(report),
		...time_phase_table.phase_lines(report.phases, report.elapsed_ms),
		...time_phase_costs.cost_lines(report.phase_costs),
		...time_cycles.cycle_lines(report.ci_cycles),
		...time_segments.segment_lines(report.segments),
		...time_trips.trip_lines(report),
		...time_gaps.gap_lines(report.gaps, report.elapsed_ms),
		...time_bundles.bundle_lines(report.bundles, report),
		...time_single_checks.single_check_lines(report.single_checks, report),
		...time_gate_runs.gate_run_lines(report.gate_runs),
		...turn_blocks(report),
		...time_ranked_tables.ranked_tables(report),
	].join('\n')
}

const time_report = {
	MAX_ROWS: time_format.MAX_ROWS,
	// The phase block's own names, re-exported so every caller keeps asking one namespace after the
	// block moved to `time-phase-table.ts` (joshuafolkken/kit#1392).
	NOT_DETECTED: time_phase_table.NOT_DETECTED,
	NOT_MEASURED: time_format.NOT_MEASURED,
	PHASE_HEADING: time_phase_table.HEADING,
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
	// Exported so a block built outside this file divides by the same model wait the category table
	// prints, rather than re-deriving the sum and coming to disagree with it (joshuafolkken/kit#1477).
	category_ms,
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

// Re-exported from where the category block now lives, so every caller keeps asking this module for
// the type it always asked for (joshuafolkken/kit#1465).
export type { CategoryTotals } from './time-category-table'
export type { LabelTotal, ReportInput, RowTotal, TimeReport, ToolTotal }
export { time_report }
