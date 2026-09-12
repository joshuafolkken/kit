import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { time_background, type BackgroundRun } from './time-background'
import { time_command_key } from './time-command-key'
import { time_format } from './time-format'
import { time_overlap, type Interval } from './time-overlap'
import { time_round_trips } from './time-round-trips'
import { time_shell } from './time-shell'
import { time_spans, type Span, type SpanOutcome } from './time-spans'

// How many times a run started the verification gate, and how many of those the procedure accounts
// for (joshuafolkken/kit#1786).
//
// **The rule has been written down since joshuafolkken/kit#1246 and nothing has ever counted against
// it.** `prompts/review.md` → "The gate runs beside this review, not in front of it" allows one gate
// per commit, plus one wherever an edit landed after a gate went green — so a clean round 1 runs the
// gate once, a round 1 that produced fixes runs it twice, and a round 2 that fixed a finding in place
// adds a second commit and a third gate. Run #1749 ran it four times, and the report said `josh gate
// — 4 call(s)` with nothing beside it to say whether four was inside the allowance or outside it.
//
// **What makes the count unreadable is that a red gate is legitimately re-run.** `prompts/review.md`
// says so in the same table, so a fourth call is waste or is exactly what the procedure asked for,
// and the two look identical in the per-invocation row. This block separates them: a gate that
// follows a failed gate is the allowed re-run, and one that follows a gate nobody could read is
// reported as undetermined rather than assigned to either side.
//
// **It counts; it does not refuse.** A `PreToolUse` refusal is the shape joshuafolkken/kit#1344 and
// joshuafolkken/kit#1460 measured as the thing that actually moves a number, and it is deliberately
// not built here: a refusal that cannot tell an allowed re-run from a wasted one would stop the run
// on a red gate, which is the one case the procedure requires. Sizing that is what this figure is
// for, once it has been read over several runs.

const { format_columns, unmeasured_row } = time_format

const HEADING = 'Gate runs:'
const RUNTIME_HEADING = 'Gate runtime (backgrounded, in run order):'
const RUNTIME_LABEL = 'gate runtime'
const RUNS_LABEL = 'josh gate runs'
const AFTER_RED_LABEL = 'after a red gate'
const UNDETERMINED_LABEL = 'could not be told'
const AFTER_RED_NOTE = 'allowed — the procedure re-runs a red gate'
const UNDETERMINED_NOTE = 'the previous gate had no readable outcome'
const ALLOWANCE_NOTE =
	'the procedure allows one gate per commit, plus one wherever an edit landed after a gate'
const NONE = 0
const FIRST = 0
const PREVIOUS = 1

// The key `time-command-key.ts` produces for `pnpm josh gate`, built from the gate's own command name
// and `time-shell.ts`'s own prefix rather than spelled out here, so a rename moves all of them at once.
const GATE_KEY = `${time_shell.JOSH_PREFIX}${GATE_COMMAND}`

// One backgrounded gate's real wall clock: from the launch to the call that read its output back, and
// how much of that the run spent on the gate alone (joshuafolkken/kit#1812).
interface GateWindow {
	started_ms: number
	ended_ms: number
	duration_ms: number
	// The part of the window nothing but the gate covered — what the run really waited on it. The
	// `ci_cycles` reading of the merge command, one command over.
	naked_ms: number
}

interface GateRunTotals {
	run_count: number
	// Gate calls whose previous gate call failed. These are the re-runs `prompts/review.md` requires,
	// so they are reported as accounted for rather than as excess.
	after_red_count: number
	// Gate calls whose previous gate call carried no readable outcome. Neither allowed nor excess —
	// **withheld is not measured as zero**, which is the distinction every other block here keeps.
	undetermined_count: number
	// Whether any span was read at all. `false` withholds the counts rather than printing them as
	// zero: a run nobody could read started no gate *that was seen*, which is not the same as a run
	// that started none.
	is_measured: boolean
	// The real runtime of each backgrounded gate that was read back. Empty where none was.
	windows: ReadonlyArray<GateWindow>
	// Whether the run backgrounded a gate at all. `false` withholds the whole runtime block: a gate that
	// ran in the foreground shows its length in `by_invocation` already, so a `not measured` row there
	// would report a length that is knowable as unknown.
	has_backgrounded_gate: boolean
	// Whether a backgrounded gate's runtime could be read at all. `false` with a backgrounded gate prints
	// `not measured` rather than a zero: the gate is launched into the background (`background-commands.md`), so `by_invocation`
	// sees only the dispatch and the phase table only the launch's own seconds — neither is its length.
	is_runtime_measured: boolean
}

const NO_GATE_RUNS: GateRunTotals = {
	run_count: NONE,
	after_red_count: NONE,
	undetermined_count: NONE,
	is_measured: false,
	windows: [],
	has_backgrounded_gate: false,
	is_runtime_measured: false,
}

// **The key an alias produces is the canonical one, and this file no longer expands it itself**
// (joshuafolkken/kit#1789). It used to: a span carried the spelling the command line used, so
// `pnpm josh ga` keyed as `josh ga` and, matched raw, a run that used the alias reported `0` gates as
// a *measurement* — the one claim every withheld state in this file exists to avoid. Expanding it
// here fixed the gate count alone and left the per-invocation table answering differently about the
// same run, so the expansion moved to `josh_command_of`, where every reading of a josh command gets
// it at once.
//
// **A continuation is not a call.** One call bracketing a delegated unit comes back from
// `time_overlap.trim` as a head and a tail, and counting the tail would report a gate the run never
// started — the same reading `time-failures.ts` takes of the same split.
function is_gate(span: Span): boolean {
	return !span.is_continuation && time_command_key.command_key(span) === GATE_KEY
}

// **Ordered before it is walked, not assumed ordered.** A run's spans arrive per session and a
// delegated unit's are appended after the parent's, so array order would pair a gate with whichever
// gate happened to be printed before it rather than with the one that actually ran before it. The
// ordering is `time-round-trips.ts`'s, shared with the failure chain rather than restated — two
// orderings could disagree about which gate came first, which is the one thing this reading rests on.
function gate_spans(spans: ReadonlyArray<Span>): Array<Span> {
	return time_round_trips.in_time_order(spans).filter((span) => is_gate(span))
}

// Each gate answers the gate before it. The first has no predecessor and is the one every run is
// allowed, so it belongs to neither bucket.
function count_following(gates: ReadonlyArray<Span>, outcome: SpanOutcome): number {
	return gates.filter((_, index) => index > FIRST && gates[index - PREVIOUS]?.outcome === outcome)
		.length
}

// The background ids of the gate launches that were backgrounded. A gate run in the foreground carries
// no background id and shows its length in its own span; this reading is for the backgrounded gate (`background-commands.md`)
// directs a run to, whose runtime the launch span alone cannot show.
function gate_background_ids(spans: ReadonlyArray<Span>): Set<string> {
	return new Set(
		spans
			.filter((span) => is_gate(span) && span.background_id !== time_background.NO_BACKGROUND)
			.map((span) => span.background_id),
	)
}

// Every span except the gate's own launch and the call that read its output back. Naked seconds are
// the part of the window those cover nothing of — the run waiting on the gate with nothing else
// running — which is exactly `ci_cycles`' treatment of the merge command it excludes.
function gate_covers(spans: ReadonlyArray<Span>, ids: ReadonlySet<string>): Array<Interval> {
	return spans
		.filter((span) => !ids.has(span.background_id) && !ids.has(span.reads_background))
		.map((span) => time_overlap.to_interval(span))
}

function to_window(run: BackgroundRun, covers: ReadonlyArray<Interval>): GateWindow {
	const window: Interval = { started_ms: run.started_ms, ended_ms: run.ended_ms }

	return {
		...window,
		duration_ms: run.ended_ms - run.started_ms,
		naked_ms: time_overlap.uncovered_ms(window, covers),
	}
}

// The real runtime of each backgrounded gate that was read back. A launch never read has no window to
// enclose anything with, so it is left out here and reported `not measured` rather than as its own
// dispatch seconds — the same direction of error `time-background.ts` already takes for an unread run.
function gate_windows(spans: ReadonlyArray<Span>, ids: ReadonlySet<string>): Array<GateWindow> {
	const covers = gate_covers(spans, ids)

	return time_background
		.runs(spans)
		.filter((run) => ids.has(run.id) && run.is_read)
		.map((run) => to_window(run, covers))
}

function build_gate_runs(spans: ReadonlyArray<Span>): GateRunTotals {
	if (spans.length === NONE) return NO_GATE_RUNS

	const gates = gate_spans(spans)
	const ids = gate_background_ids(spans)
	const windows = gate_windows(spans, ids)

	return {
		run_count: gates.length,
		after_red_count: count_following(gates, time_spans.FAILED_OUTCOME),
		undetermined_count: count_following(gates, time_spans.UNKNOWN_OUTCOME),
		is_measured: true,
		windows,
		has_backgrounded_gate: ids.size > NONE,
		is_runtime_measured: windows.length > NONE,
	}
}

const LABELS = [RUNS_LABEL, AFTER_RED_LABEL, UNDETERMINED_LABEL]

function measured_lines(totals: GateRunTotals): Array<string> {
	return [
		format_columns(RUNS_LABEL, String(totals.run_count), ''),
		format_columns(AFTER_RED_LABEL, String(totals.after_red_count), AFTER_RED_NOTE),
		format_columns(UNDETERMINED_LABEL, String(totals.undetermined_count), UNDETERMINED_NOTE),
	]
}

function window_row(window: GateWindow): string {
	const naked = `${time_format.NAKED_PREFIX}${time_format.format_seconds(window.naked_ms)}`

	return time_format.format_row(
		time_format.format_window(window.started_ms, window.ended_ms),
		window.duration_ms,
		naked,
	)
}

// The runtime of the backgrounded gate, in the shape `ci_cycles` uses: the real length, and the naked
// seconds the run spent on it alone. A gate that ran but was never read back says `not measured`
// rather than the launch's own two seconds, which is the dispatch and not the gate.
function runtime_lines(totals: GateRunTotals): Array<string> {
	if (!totals.is_measured || !totals.has_backgrounded_gate) return []

	const heading = ['', RUNTIME_HEADING]

	if (!totals.is_runtime_measured) return [...heading, unmeasured_row(RUNTIME_LABEL)]

	return [...heading, ...totals.windows.map((window) => window_row(window))]
}

// **A run whose transcript was not read says so rather than reporting no gate.** Zero here would read
// as a run that never verified anything, which is the one answer an unread transcript cannot support.
function gate_run_lines(totals: GateRunTotals): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) return [...heading, ...LABELS.map((label) => unmeasured_row(label))]

	return [
		...heading,
		...measured_lines(totals),
		...time_format.note_lines([ALLOWANCE_NOTE]),
		...runtime_lines(totals),
	]
}

const time_gate_runs = {
	HEADING,
	RUNTIME_HEADING,
	RUNTIME_LABEL,
	RUNS_LABEL,
	AFTER_RED_LABEL,
	UNDETERMINED_LABEL,
	ALLOWANCE_NOTE,
	GATE_KEY,
	NO_GATE_RUNS,
	build_gate_runs,
	gate_run_lines,
}

export type { GateRunTotals, GateWindow }
export { time_gate_runs }
