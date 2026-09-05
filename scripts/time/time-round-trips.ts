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

// The calls of one round trip, as the walk below accumulates them.
interface TripWalk {
	trips: Array<Array<Span>>
	// The trip currently open, or `undefined` where the span just seen closed one. A group of adjacent
	// tool spans headed by a continuation opens none — `opens_round_trip` refuses it — so its calls
	// find no open trip and are attributed to nothing rather than to the trip before them.
	open: Array<Span> | undefined
}

function step_trip(walk: TripWalk, span: Span, is_opener: boolean): void {
	if (!is_tool(span)) {
		walk.open = undefined

		return
	}

	if (is_opener) {
		walk.open = []
		walk.trips.push(walk.open)
	}

	if (!span.is_continuation) walk.open?.push(span)
}

// **A round trip as the calls it carried, rather than as a count** (joshuafolkken/kit#1385). The count
// is what this returns the length of, so the two cannot come to disagree about what a round trip is —
// which is the whole point of asking here rather than grouping the spans a second time next door.
//
// A continuation is in no group: `count_calls` already refuses to count it as a call, and a group that
// held it would report the tail of one call as a second one made in that turn.
function group_round_trips(spans: ReadonlyArray<Span>): Array<ReadonlyArray<Span>> {
	const ordered = in_time_order(spans)
	const walk: TripWalk = { trips: [], open: undefined }

	// A loop rather than `reduce`, which this project's lint config forbids — `fold_issuing` below
	// drains its spans the same way.
	for (const [index, span] of ordered.entries()) {
		step_trip(walk, span, opens_round_trip(ordered, index))
	}

	return walk.trips
}

// One per group of adjacent tool spans: the first tool span after anything that is not one.
function count_round_trips(spans: ReadonlyArray<Span>): number {
	return group_round_trips(spans).length
}

// One round trip's share of the model wait, as the stretch it actually was
// (joshuafolkken/kit#1386). The price the report prints is the mean of these; a run's longest single
// stretch — 189 seconds of run #1379, 12% of the whole run — is invisible in that mean and is exactly
// what this record keeps.
interface ModelGap {
	duration_ms: number
	started_ms: number
	ended_ms: number
	// Where the stretch began, as an index into the time-ordered spans: the first model span of it, or
	// the round trip's own opener where nothing preceded it. An index rather than a phase name, because
	// this module classifies nothing — `time-gaps.ts` reads the phase off it, so the two cannot come to
	// order the spans differently.
	span_index: number
}

// A span with the position it holds in the ordered array, which is what carries the phase across.
interface Indexed {
	index: number
	span: Span
}

// The stretch currently accumulating, and the stretches already charged to a round trip.
interface GapWalk {
	pending: Array<Indexed>
	gaps: Array<ModelGap>
}

// **A round trip opened with nothing pending is a gap of zero, not a gap that did not happen.** The
// mean the report already prints divides the whole issuing time by the round-trip count, so a
// distribution that dropped those would sit above the mean beside it — one report disagreeing with
// itself about the same quantity.
//
// **The window ends where the last member ended, not where the durations add up to.** The two agree
// only where consecutive model spans tile, and this module's own walk names two places they do not: a
// turn that bracketed a delegated unit, and a session seam `time_corpus` concatenated with nothing in
// between. The duration would be right either way; the *window* is what a reader takes back to the
// transcript to find the turn behind a figure, so a start plus a sum would send them to the wrong one.
// An empty stretch has no last member and is stood in for by the opener, which gives it a window of
// zero length at the instant the round trip opened.
function to_gap(pending: ReadonlyArray<Indexed>, opener: Indexed): ModelGap {
	const first = pending[0] ?? opener
	const last = pending.at(-1)
	const duration_ms = pending.reduce((sum, entry) => sum + entry.span.duration_ms, NONE)

	return {
		duration_ms,
		started_ms: started_ms(first.span),
		ended_ms: last?.span.ended_ms ?? started_ms(opener.span),
		span_index: first.index,
	}
}

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
function step_gap(walk: GapWalk, entry: Indexed, is_opener: boolean): void {
	if (is_model(entry.span)) {
		walk.pending.push(entry)

		return
	}

	if (is_opener) walk.gaps.push(to_gap(walk.pending, entry))
	walk.pending = []
}

// **One stretch per round trip, in run order** (joshuafolkken/kit#1386). `group_round_trips` pushes a
// group on exactly the openers this pushes a gap on, so the two lists are the same length by
// construction rather than by assumption.
function issuing_model_gaps(spans: ReadonlyArray<Span>): Array<ModelGap> {
	const ordered = in_time_order(spans)
	const walk: GapWalk = { pending: [], gaps: [] }

	// A loop rather than `reduce`, which this project's lint config forbids — `group_round_trips` above
	// drains its spans the same way.
	for (const [index, span] of ordered.entries()) {
		step_gap(walk, { index, span }, opens_round_trip(ordered, index))
	}

	return walk.gaps
}

// The model time that actually issued the round trips — the numerator of the price the report
// prints, and the share of it a batching change removes (joshuafolkken/kit#1307).
//
// **Defined as the sum of the stretches above rather than folded separately** (joshuafolkken/kit#1386).
// The mean and the distribution are then two readings of one walk, so the report cannot come to print
// a mean the spread it sits beside could not produce.
function issuing_model_ms(spans: ReadonlyArray<Span>): number {
	return issuing_model_gaps(spans).reduce((sum, gap) => sum + gap.duration_ms, NONE)
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
	// Exported since joshuafolkken/kit#1385, so the per-tool counts are read off the very groups this
	// module counts rather than off a second grouping beside them.
	group_round_trips,
	// Exported since joshuafolkken/kit#1309, so the failure aggregation orders a run's spans through
	// the one function that already knows why they need it — a second `toSorted` beside it would be
	// the clone `CLAUDE.md` prohibits, and the seam it guards (a delegated unit's spans appended
	// after the parent's) is not one a second copy would keep remembering.
	in_time_order,
	is_below_floor,
	// Exported since joshuafolkken/kit#1386, so the distribution `time-gaps.ts` reports is read off the
	// very stretches the mean is summed from rather than off a second walk beside them.
	issuing_model_gaps,
	issuing_model_ms,
	per_round_trip,
}

export type { ModelGap }
export { time_round_trips }
