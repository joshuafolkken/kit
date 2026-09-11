import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { time_command_key } from './time-command-key'
import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
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
// rather than spelled out here, so a rename moves both at once.
const GATE_KEY = `josh ${GATE_COMMAND}`

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
}

const NO_GATE_RUNS: GateRunTotals = {
	run_count: NONE,
	after_red_count: NONE,
	undetermined_count: NONE,
	is_measured: false,
}

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

function build_gate_runs(spans: ReadonlyArray<Span>): GateRunTotals {
	if (spans.length === NONE) return NO_GATE_RUNS

	const gates = gate_spans(spans)

	return {
		run_count: gates.length,
		after_red_count: count_following(gates, time_spans.FAILED_OUTCOME),
		undetermined_count: count_following(gates, time_spans.UNKNOWN_OUTCOME),
		is_measured: true,
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

// **A run whose transcript was not read says so rather than reporting no gate.** Zero here would read
// as a run that never verified anything, which is the one answer an unread transcript cannot support.
function gate_run_lines(totals: GateRunTotals): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) return [...heading, ...LABELS.map((label) => unmeasured_row(label))]

	return [...heading, ...measured_lines(totals), ...time_format.note_lines([ALLOWANCE_NOTE])]
}

const time_gate_runs = {
	HEADING,
	RUNS_LABEL,
	AFTER_RED_LABEL,
	UNDETERMINED_LABEL,
	ALLOWANCE_NOTE,
	GATE_KEY,
	NO_GATE_RUNS,
	build_gate_runs,
	gate_run_lines,
}

export type { GateRunTotals }
export { time_gate_runs }
