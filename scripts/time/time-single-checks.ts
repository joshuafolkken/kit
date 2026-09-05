import type { TripPrice } from './time-bundles'
import { time_format } from './time-format'
import { time_phases, type PhaseName } from './time-phases'
import { time_placed, type Placed } from './time-placed'
import { time_single_check } from './time-single-check'
import { time_spans, type Span } from './time-spans'

// How much of a run was spent re-verifying file by file between edits, when the gate re-ran the same
// four checks minutes later (joshuafolkken/kit#1383).
//
// `CLAUDE.md` has said **one gate per run, not one per edit** since joshuafolkken/kit#1246, and the
// single checks are what that rule sends an implementation loop to instead. Nothing measured whether
// the loop then repeated *them*. Run #1379 issued eight single checks — 45.9 seconds of tool time,
// six of them in the fix phase, each its own round trip — three of which repeated an earlier call on
// the same arguments, and 18.1 seconds after the last one `josh gate` ran all four checks over the
// same tree.
//
// **The line this counts against is the narrow one, and it is stated in `prompts/review.md` →
// "A single check answers once per tree".** A check run after an edit is feedback and is not counted
// as waste however often it happens; what is counted is a repeat of the same command **with the same
// arguments** over a tree nothing has touched since — the one class of call whose answer was knowable
// before it was asked. Nothing here proposes a mechanism, for the reason `time-bundles.ts` gives: a
// mechanism sized on an assumed figure is sized by the assumption.
//
// ## What the figure cannot see
//
// **It under-reports, and never the other way.** A repeat separated by a plain `Read` or a `grep` is
// real waste and is not counted, because nothing here can prove those calls changed no file — only a
// model turn, and the tail of a check call already counted at its head, are accepted as leaving an
// answer standing. **That strictness is what makes an edit made through the shell safe**: `sed -i`
// carries no edit marker, but it is a Bash call like any other and clears the answer exactly as an
// `Edit` does. A consumer project's type check is `josh-app check:ci`, which is not a
// `pnpm josh <cmd>` call at all, so no subcommand is read off it and none of its calls are counted.

const { format_columns, format_row, format_seconds, unmeasured_row, SUFFIX_SEPARATOR } = time_format

const HEADING = 'Single checks:'
const CALLS_LABEL = 'single checks'
const REPEAT_LABEL = 'repeat calls'
const UNCHANGED_LABEL = 'answered nothing new'
// **Not `recoverable wait`.** That is the `Bundling:` block's own row, and a reader filtering the
// report by a label would count one saving under two headings.
const SAVING_LABEL = 'recoverable check time'
const REPEAT_NOTE = 'same command and arguments'
const UNCHANGED_NOTE = 'no edit between the two calls'
const TOOL_TIME_NOTE = 'of tool time'
const REWORK_NOTE = 'in the rework phase'
const NONE = 0
const ONE = 1

// What the walk established. **`is_measured` is not `call_count > 0`**: a run that issued no single
// check at all and a run whose transcript was never read both total zero, and printing the same rows
// for the two would report the second as though it had been read.
interface SingleCheckTotals {
	call_count: number
	// How many of them sat in the fix phase — the window from the first gate to the pull request,
	// which is the stretch joshuafolkken/kit#1383 was filed from.
	rework_call_count: number
	duration_ms: number
	repeat_count: number
	unchanged_count: number
	unchanged_ms: number
	// How many of those repeats were the only call in their turn, and so cost a round trip of their
	// own. **Not the same as `unchanged_count`**: two of them issued together are one stop, and pricing
	// both would promise back model time no change removes — an over-report in a block that leans the
	// other way everywhere else.
	unchanged_trip_count: number
	is_measured: boolean
}

const NO_SINGLE_CHECKS: SingleCheckTotals = {
	call_count: NONE,
	rework_call_count: NONE,
	duration_ms: NONE,
	repeat_count: NONE,
	unchanged_count: NONE,
	unchanged_ms: NONE,
	unchanged_trip_count: NONE,
	is_measured: false,
}

// The walk's three pieces: the running totals, every signature the run has issued, and the subset of
// those whose last answer still describes the tree.
interface Walk {
	totals: SingleCheckTotals
	seen: Set<string>
	answered: Set<string>
}

function empty_totals(is_measured: boolean): SingleCheckTotals {
	return { ...NO_SINGLE_CHECKS, is_measured }
}

// A call, as opposed to the tail of one. A continuation is the remainder of a call whose middle went
// to a delegated unit, and counting it would report a run as having checked more often than it did —
// the same double count `time-round-trips.ts` and `time-bundles.ts` already refuse.
function is_check(span: Span): boolean {
	if (span.category !== time_spans.TOOL_CATEGORY || span.is_continuation) return false

	return span.check_key !== time_single_check.NO_CHECK
}

// Whether a span sitting between two calls of one check leaves the earlier answer standing. **A model
// turn does, and so does the tail of a check call already counted at its head** — the second is the
// same call rather than a new event, and letting it clear the set would silently drop the next real
// repeat from the count. Nothing else does, and the strictness is deliberate: a `Read` proves nothing
// about the tree, a human span means somebody had the keyboard, and every other tool call may have
// written a file — `sed -i` included, which is what makes an edit made through the shell safe here.
function keeps_answer(span: Span): boolean {
	if (span.category === time_spans.MODEL_CATEGORY) return true

	return span.is_continuation && span.check_key !== time_single_check.NO_CHECK
}

function count_repeat(walk: Walk, span: Span, is_alone: boolean): void {
	if (walk.seen.has(span.check_key)) walk.totals.repeat_count += ONE
	if (!walk.answered.has(span.check_key)) return

	walk.totals.unchanged_count += ONE
	walk.totals.unchanged_ms += span.duration_ms
	if (is_alone) walk.totals.unchanged_trip_count += ONE
}

function count_check(
	walk: Walk,
	span: Span,
	phase: PhaseName | undefined,
	is_alone: boolean,
): void {
	count_repeat(walk, span, is_alone)

	walk.totals.call_count += ONE
	walk.totals.duration_ms += span.duration_ms
	if (phase === time_phases.REWORK_PHASE) walk.totals.rework_call_count += ONE

	walk.seen.add(span.check_key)
	walk.answered.add(span.check_key)
}

function step(walk: Walk, span: Span, phase: PhaseName | undefined, is_alone: boolean): void {
	if (is_check(span)) {
		count_check(walk, span, phase, is_alone)

		return
	}

	if (!keeps_answer(span)) walk.answered.clear()
}

function is_tool_at(entries: ReadonlyArray<Placed>, index: number): boolean {
	return entries[index]?.span.category === time_spans.TOOL_CATEGORY
}

// **Whether removing this call would save a round trip, which is "alone in its trip" and not "first
// in it".** A round trip is a group of adjacent tool spans (`time-round-trips.ts`), so a call issued
// beside another is one the run stopped for anyway — taking it out leaves the stop where it was.
// Reading the first of a group as its own trip billed exactly that, which is the over-report this
// block leans away from everywhere else.
function is_alone_in_trip(entries: ReadonlyArray<Placed>, index: number): boolean {
	return !is_tool_at(entries, index - ONE) && !is_tool_at(entries, index + ONE)
}

// **Ordered before it is walked, and `time-placed.ts` is what does both.** A run's spans do not
// arrive in time order — a delegated unit's are appended after the parent's, and `time-corpus.ts`
// concatenates one session after another — so an array-order walk would read two sessions' calls as
// consecutive and report a repeat nobody made. The pairing with each span's phase is that module's
// too rather than a third copy of it (joshuafolkken/kit#1383).
function build_single_checks(spans: ReadonlyArray<Span>): SingleCheckTotals {
	const walk: Walk = {
		totals: empty_totals(time_spans.has_transcript_data(spans.length)),
		seen: new Set<string>(),
		answered: new Set<string>(),
	}
	const entries = time_placed.placed_spans(spans)

	// A loop rather than `reduce`: the walk carries three pieces and mutates them, the shape
	// `time-bundles.ts` uses for the same reason.
	for (const [index, entry] of entries.entries()) {
		step(walk, entry.span, entry.phase, is_alone_in_trip(entries, index))
	}

	return walk.totals
}

function calls_suffix(totals: SingleCheckTotals): string {
	const rework = `${String(totals.rework_call_count)} ${REWORK_NOTE}`

	return [rework, `${format_seconds(totals.duration_ms)} ${TOOL_TIME_NOTE}`].join(SUFFIX_SEPARATOR)
}

function unchanged_suffix(totals: SingleCheckTotals): string {
	return [format_seconds(totals.unchanged_ms), UNCHANGED_NOTE].join(SUFFIX_SEPARATOR)
}

// **The tool time and the round trip are both counted, and neither on its own is the cost.** The
// check's own seconds are paid whichever turn it went out from, and a call that was the only one in
// its turn also stopped the run once — so the saving is the execution plus the model wait of the trips
// those calls opened, at the price the `Round trips:` block above already prints. **The trips are
// counted rather than the calls**: two repeats issued together are one stop, and billing both would
// promise back model time no change removes.
function saving_line(totals: SingleCheckTotals, model_ms_per_round_trip: number): string {
	const saved_ms = totals.unchanged_ms + totals.unchanged_trip_count * model_ms_per_round_trip
	const rate = `at ${format_seconds(model_ms_per_round_trip)} model time per round trip`

	return format_row(SAVING_LABEL, saved_ms, rate)
}

function count_lines(totals: SingleCheckTotals): Array<string> {
	return [
		format_columns(CALLS_LABEL, String(totals.call_count), calls_suffix(totals)),
		format_columns(REPEAT_LABEL, String(totals.repeat_count), REPEAT_NOTE),
		format_columns(UNCHANGED_LABEL, String(totals.unchanged_count), unchanged_suffix(totals)),
	]
}

const LABELS = [CALLS_LABEL, REPEAT_LABEL, UNCHANGED_LABEL, SAVING_LABEL]

// **Only the saving row is withheld when there was no round trip to divide by, and the three counts
// above it are not.** This differs from the `Bundling:` block deliberately: two of that block's three
// rows are themselves shares of the round-trip count, while these three are counts of calls — and a
// transcript that was read and issued no call really did issue no single check, which is a
// measurement rather than an unknown.
function measured_lines(totals: SingleCheckTotals, price: TripPrice): Array<string> {
	if (price.round_trip_count === NONE) {
		return [...count_lines(totals), format_columns(SAVING_LABEL, '', time_format.NO_CALLS)]
	}

	return [...count_lines(totals), saving_line(totals, price.model_ms_per_round_trip)]
}

// **A run whose transcript was not read says so rather than reporting nothing repeated.** Zero here
// would read as a run that probed nothing, which is the one answer an unread transcript cannot
// support — the same word the category shares and the two blocks above this one use.
function single_check_lines(totals: SingleCheckTotals, price: TripPrice): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) return [...heading, ...LABELS.map((label) => unmeasured_row(label))]

	return [...heading, ...measured_lines(totals, price)]
}

const time_single_checks = {
	HEADING,
	CALLS_LABEL,
	REPEAT_LABEL,
	UNCHANGED_LABEL,
	SAVING_LABEL,
	REPEAT_NOTE,
	UNCHANGED_NOTE,
	NO_SINGLE_CHECKS,
	build_single_checks,
	single_check_lines,
}

export type { SingleCheckTotals }
export { time_single_checks }
