import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// How many of a run's round trips were avoidable, read from the run rather than assumed
// (joshuafolkken/kit#1344).
//
// Three runs in a row came in at 1.10–1.12 calls per round trip against a 1.50 floor, and neither the
// end-of-run warning (joshuafolkken/kit#1304) nor the live line (joshuafolkken/kit#1329) moved the
// number. The Issue's estimate of what batching would return — 33 round trips of 136, about 4.8
// minutes — was arithmetic on the floor: it assumed every call could be bundled to 1.50 and said
// nothing about which ones actually could. **A mechanism proposed on that figure would be sized by an
// assumption**, which is what this module replaces.
//
// **A sequence is consecutive single-call round trips whose calls do not touch one another's
// targets.** Each such sequence of `n` turns could have been one, so `n - 1` of its round trips were
// avoidable. Nothing here proposes a mechanism; it establishes the size of what one would be worth.
//
// ## What the figure cannot see, in both directions
//
// **It under-reports** wherever the target test finds an overlap that was not a dependency — two
// unrelated reads of the same file, or a read inside a directory an earlier call merely mentioned —
// and wherever a chained shell command was excluded for holding a mutation word it never used as one.
//
// **It over-reports** wherever a call named no target at all: a dependency that exists only in the
// earlier call's *output* is invisible here, because no result text is retained anywhere in this
// pipeline. `gh issue view 1344` followed by a read of what it printed is the shape that escapes.
//
// So it is an estimate with its error stated, not a floor and not a ceiling — and it is an estimate
// of what a run did rather than of what a target density implies.

const HEADING = 'Bundling:'
const SEQUENCE_LABEL = 'bundleable sequences'
const RECOVERABLE_LABEL = 'recoverable round trips'
// **Not `model wait recoverable`.** The category table's own row is `model wait`, and every reader
// of this report filters its rows by a substring — a label holding that phrase would be counted as a
// fourth category share by anything looking for the three.
const SAVING_LABEL = 'recoverable wait'
// Two turns is the smallest thing that could have been one. A sequence of one is a turn that had
// nothing to go out beside, which is not a finding.
const MIN_SEQUENCE = 2
const ONE_CALL = 1
const NONE = 0
const PATH_SEPARATOR = '/'

// What the walk established about a run. **`is_measured` is not `sequence_count > 0`**: a run that
// batched everything genuinely has no sequence, and a run whose transcript was never read has none
// either — printing `0` for both would report the first as though it were the second.
interface BundleTotals {
	sequence_count: number
	longest_sequence: number
	recoverable_round_trips: number
	is_measured: boolean
}

const NO_BUNDLES: BundleTotals = {
	sequence_count: 0,
	longest_sequence: 0,
	recoverable_round_trips: 0,
	is_measured: false,
}

// Whether `whole` contains `part` **as a run of whole path segments**. Three positions, because a
// path can hold another at its head, its tail or its middle, and a plain `includes` would match
// `scripts/time-x` inside `scripts/time-xyz`.
//
// **The tail position is what makes an absolute path comparable with a relative one.** A `Read` call
// names `/Users/…/kit/scripts/time/x.ts` while the `grep` before it named `scripts/time`, and nothing
// here knows the working directory the second was relative to — so the search-then-read pair, which is
// the whole reason the target test exists, would escape it on the two shapes it occurs in most.
function contains_segments(whole: string, part: string): boolean {
	if (whole.startsWith(`${part}${PATH_SEPARATOR}`)) return true

	return (
		whole.endsWith(`${PATH_SEPARATOR}${part}`) ||
		whole.includes(`${PATH_SEPARATOR}${part}${PATH_SEPARATOR}`)
	)
}

// Equal, or one inside the other. The containing form is what catches the search-then-read pair:
// `grep -rn foo scripts` names `scripts`, and the `cat scripts/time/x.ts` that follows it names a path
// beneath — which is exactly how the second call learned the first one's answer.
function is_related(left: string, right: string): boolean {
	if (left === right) return true

	return contains_segments(left, right) || contains_segments(right, left)
}

function shares_target(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
	return left.some((one) => right.some((other) => is_related(one, other)))
}

function conflicts(span: Span, sequence: ReadonlyArray<Span>): boolean {
	return sequence.some((earlier) => shares_target(earlier.targets, span.targets))
}

// A call, as opposed to the tail of one. A continuation is the remainder of a call whose middle went
// to a delegated unit, and `time-round-trips.ts` already refuses to count it as a second call.
function is_call(span: Span): boolean {
	return span.category === time_spans.TOOL_CATEGORY && !span.is_continuation
}

// Whether the span between two round trips leaves them consecutive. Only a model span does: a person
// typing means the second turn was composed after an interruption, and a continuation means a
// delegated unit ran in between — neither pair could have gone out together.
function is_turn_boundary(span: Span): boolean {
	return span.category === time_spans.MODEL_CATEGORY
}

// The walk's three running pieces: the calls of the round trip currently open, the sequence being
// extended, and the sizes of the sequences already closed.
interface Walk {
	pending: Array<Span>
	sequence: Array<Span>
	sizes: Array<number>
}

function new_walk(): Walk {
	return { pending: [], sequence: [], sizes: [] }
}

function flush(walk: Walk): void {
	if (walk.sequence.length >= MIN_SEQUENCE) walk.sizes.push(walk.sequence.length)

	walk.sequence = []
}

// A conflicting call does not end the run of single-call turns; it starts a new sequence at itself,
// because everything after it may still have been bundleable with it.
function extend(walk: Walk, span: Span): void {
	if (conflicts(span, walk.sequence)) flush(walk)

	walk.sequence.push(span)
}

// **A turn that issued several calls breaks the sequence rather than joining it.** It is a turn that
// already batched, and the question here is what the single-call turns cost — folding a batched turn
// in would count the improvement as part of the defect.
function close_trip(walk: Walk): void {
	const [only] = walk.pending

	if (walk.pending.length === ONE_CALL && only?.is_bundleable === true) extend(walk, only)
	else if (walk.pending.length > NONE) flush(walk)

	walk.pending = []
}

function step(walk: Walk, span: Span): void {
	if (is_call(span)) {
		walk.pending.push(span)

		return
	}

	close_trip(walk)
	if (!is_turn_boundary(span)) flush(walk)
}

function longest_of(sizes: ReadonlyArray<number>): number {
	return sizes.length === NONE ? NONE : Math.max(...sizes)
}

// One sequence of `n` turns could have been one turn, so it holds `n - 1` avoidable round trips.
function recoverable_of(sizes: ReadonlyArray<number>): number {
	return sizes.reduce((sum, size) => sum + size - ONE_CALL, NONE)
}

// **Ordered before it is walked, for the reason `time-failures.ts` states.** A run's spans do not
// arrive in time order: a delegated unit's are appended after the parent's, and `time_corpus`
// concatenates one session after another. Walked in array order, two turns from different sessions
// would read as consecutive and be counted as a sequence nobody could have batched.
function build_bundles(spans: ReadonlyArray<Span>): BundleTotals {
	const walk = new_walk()

	// A loop rather than `reduce`: the walk carries three pieces and mutates them, which is the shape
	// `time-failures.ts` uses for the same reason.
	for (const span of time_round_trips.in_time_order(spans)) step(walk, span)

	close_trip(walk)
	flush(walk)

	return {
		sequence_count: walk.sizes.length,
		longest_sequence: longest_of(walk.sizes),
		recoverable_round_trips: recoverable_of(walk.sizes),
		is_measured: time_spans.has_transcript_data(spans.length),
	}
}

function sequence_suffix(totals: BundleTotals): string {
	return `longest ${String(totals.longest_sequence)} turn(s)`
}

// What the report already knows about a round trip, taken as one record so the caller hands over the
// report itself rather than picking two fields out of it — and so `time-report.ts` never imports a
// type from here that it would then have to export back.
interface TripPrice {
	round_trip_count: number
	model_ms_per_round_trip: number
}

function recoverable_suffix(totals: BundleTotals, round_trip_count: number): string {
	const share = time_format.format_share(totals.recoverable_round_trips, round_trip_count)

	return `${share} of ${String(round_trip_count)} round trip(s)`
}

// **The model share is what a batching change actually returns**, for the reason `time-report.ts`
// gives beside the unit price: a tool's own execution is paid whichever turn it was issued from, so
// multiplying the avoidable trips by the whole price would promise back seconds no change removes.
function saving_line(totals: BundleTotals, model_ms_per_round_trip: number): string {
	const saved_ms = totals.recoverable_round_trips * model_ms_per_round_trip
	const rate = `at ${time_format.format_seconds(model_ms_per_round_trip)} model time per round trip`

	return time_format.format_row(SAVING_LABEL, saved_ms, rate)
}

function measured_lines(totals: BundleTotals, price: TripPrice): Array<string> {
	return [
		time_format.format_columns(
			SEQUENCE_LABEL,
			String(totals.sequence_count),
			sequence_suffix(totals),
		),
		time_format.format_columns(
			RECOVERABLE_LABEL,
			String(totals.recoverable_round_trips),
			recoverable_suffix(totals, price.round_trip_count),
		),
		saving_line(totals, price.model_ms_per_round_trip),
	]
}

// **A run whose transcript was not read says so rather than reporting nothing to recover.** Zero here
// would read as a run that batched everything, which is the one answer an unread transcript cannot
// support — the same shape, and the same word, the category shares and the round-trip block use.
function bundle_lines(totals: BundleTotals, price: TripPrice): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) {
		const labels = [SEQUENCE_LABEL, RECOVERABLE_LABEL, SAVING_LABEL]

		return [...heading, ...labels.map((label) => time_format.unmeasured_row(label))]
	}

	return [...heading, ...measured_lines(totals, price)]
}

const time_bundles = {
	HEADING,
	SEQUENCE_LABEL,
	RECOVERABLE_LABEL,
	SAVING_LABEL,
	MIN_SEQUENCE,
	NO_BUNDLES,
	build_bundles,
	bundle_lines,
}

export type { BundleTotals, TripPrice }
export { time_bundles }
