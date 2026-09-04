import { time_spans, type Span } from './time-spans'

// How many times a run stopped and waited for a tool result (joshuafolkken/kit#1304).
//
// The other `time-*` modules measure *duration*: where the wall clock went, and which command spent
// it. This measures the one thing duration cannot see. Measured on four runs, the tools themselves
// executed for well under a minute in total while the turns those calls sat in cost ten to fourteen
// times that — so a run's floor is set by how many times it went round, not by how much the tools
// did. A report that prints only durations therefore cannot say whether a run got faster for the
// reason the change intended.
//
// **A round trip is a maximal run of consecutive tool spans, not a tool call.** Spans are ordered by
// the event that closes them and an assistant line opens every turn, so tool spans sit adjacent
// exactly when their calls were issued together in one turn. Counting calls instead would report a
// turn that batched four reads as four round trips — which is the improvement, scored as the defect.

// Below this, a run is issuing about one call per turn: nothing is being batched, and the turn count
// (which is what the wall clock is charged per) is as high as the call count. Set from the four runs
// measured on joshuafolkken/kit#1304 — #1251, #1290, #1292 and #1295 — whose densities were 1.13,
// 1.04, 1.03 and 1.00: every one of them a run in which independent reads and edits went out one per
// turn. A run that batches even occasionally clears this, so it flags the absence of batching rather
// than grading its degree.
const CALLS_PER_ROUND_TRIP_FLOOR = 1.5
const DENSITY_DECIMALS = 2
const NONE = 0

function is_tool(span: Span): boolean {
	return span.category === time_spans.TOOL_CATEGORY
}

function is_model(span: Span): boolean {
	return span.category === time_spans.MODEL_CATEGORY
}

function started_ms(span: Span): number {
	return span.ended_ms - span.duration_ms
}

// **The order is established here rather than assumed.** One session's spans arrive in time order,
// but a run's do not: `time_overlap.resolve_delegated` appends every delegated span after the
// parent's, and `time_corpus` concatenates one session's array after another's. Two tool spans that
// meet only at such a seam would merge into one group, counting fewer round trips than the run made
// — in the direction that hides the warning. Sorting by the instant a span *opened* rather than
// closed keeps a zero-length span beside the call it belongs to.
function in_time_order(spans: ReadonlyArray<Span>): Array<Span> {
	return spans.toSorted((left, right) => started_ms(left) - started_ms(right))
}

// Whether the span at `index` is a tool span, answering `false` for an index off either end. The
// out-of-range answer is what makes the first span of an array start a round trip rather than
// needing a case of its own.
function is_tool_at(spans: ReadonlyArray<Span>, index: number): boolean {
	const span = spans[index]

	return span !== undefined && is_tool(span)
}

// **A continuation is not a second call.** A call that brackets a delegated unit comes back from
// `time_overlap.trim` as two spans, and counting both would report a run as having made more calls
// than it did — inflating the density, which is again the direction that hides the warning.
function count_calls(spans: ReadonlyArray<Span>): number {
	return spans.filter((span) => is_tool(span) && !span.is_continuation).length
}

// **A continuation never opens one either.** The tail of a call whose middle went to a delegated
// unit sits after that unit's spans, and the last of those is the subagent's own turn — a model
// span — so the tail would otherwise read as a fresh call issued alone. Counting it that way moves
// the density in *both* wrong directions at once, one call fewer over one trip more, which is how a
// turn that batched and delegated could print the warning meant for a turn that did neither.
function opens_round_trip(spans: ReadonlyArray<Span>, index: number): boolean {
	const span = spans[index]

	if (span === undefined || !is_tool(span) || span.is_continuation) return false

	return !is_tool_at(spans, index - 1)
}

// One per group of adjacent tool spans: the first tool span after anything that is not one.
function count_round_trips(spans: ReadonlyArray<Span>): number {
	const ordered = in_time_order(spans)

	return ordered.filter((_span, index) => opens_round_trip(ordered, index)).length
}

// The two running totals `fold_issuing` carries: the model time seen since the last thing that was
// not a model span, and the model time already charged to a round trip.
interface IssuingTotals {
	pending_ms: number
	issuing_ms: number
}

const NO_TOTALS: IssuingTotals = { pending_ms: 0, issuing_ms: 0 }

// A turn's model time is charged to a round trip only when that turn went on to open one. **The run's
// whole model wait is a different quantity**: a turn that called no tool — the answer that ends a
// reply, the turn that stops to wait for a person — composed nothing a batching change could remove,
// and folding it in prices every round trip above what cutting one actually returns.
//
// **Opening a round trip is the only thing that keeps pending time**; everything else drops it. The
// third branch is not only the human wait it was written for: a continuation — the tail of a call
// whose middle went to a delegated unit — opens no round trip, and carrying pending across it would
// charge the subagent's closing answer to the *parent's* next trip. A session seam does the same,
// since `time_corpus` concatenates one session's spans after another's with nothing in between.
function fold_issuing(totals: IssuingTotals, span: Span, is_opener: boolean): IssuingTotals {
	if (is_model(span)) return { ...totals, pending_ms: totals.pending_ms + span.duration_ms }
	if (is_opener) return { pending_ms: 0, issuing_ms: totals.issuing_ms + totals.pending_ms }

	return { ...totals, pending_ms: 0 }
}

// The model time that actually issued the round trips — the numerator of the price the report
// prints, and the share of it a batching change removes (joshuafolkken/kit#1307).
function issuing_model_ms(spans: ReadonlyArray<Span>): number {
	const ordered = in_time_order(spans)
	let totals = NO_TOTALS

	// A loop rather than `reduce`, which this project's lint config forbids — `totals_by` in
	// `time-report.ts` drains its map the same way.
	for (const [index, span] of ordered.entries()) {
		totals = fold_issuing(totals, span, opens_round_trip(ordered, index))
	}

	return totals.issuing_ms
}

// What one round trip cost, in whatever unit the numerator carries: calls, for the density the floor
// above is quoted in, and milliseconds for the price joshuafolkken/kit#1307 added. **One divisor with
// one guard, rather than a second copy per unit** — the two are the same question about the same
// denominator, and a guard written into only one of them would print, in the unit that lacked it,
// exactly the measurement the other withholds.
//
// **Zero round trips is not a cost of zero.** A scope whose transcript was never read has no calls
// and no trips, and dividing there would assert a measurement nobody took — the report withholds the
// rows on the same criterion it withholds the three category shares on.
function per_round_trip(total: number, round_trip_count: number): number {
	if (round_trip_count === NONE) return NONE

	return total / round_trip_count
}

function format_density(density: number): string {
	return density.toFixed(DENSITY_DECIMALS)
}

// The verdict is a threshold rather than a judgement, for the reason `josh review:level` and
// `josh latest:scope` are commands: a number read under time pressure is read as acceptable exactly
// when it is not.
function is_below_floor(density: number): boolean {
	return density > NONE && density < CALLS_PER_ROUND_TRIP_FLOOR
}

const time_round_trips = {
	CALLS_PER_ROUND_TRIP_FLOOR,
	count_calls,
	count_round_trips,
	format_density,
	is_below_floor,
	issuing_model_ms,
	per_round_trip,
}

export { time_round_trips }
