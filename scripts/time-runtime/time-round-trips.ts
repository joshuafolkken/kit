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
// **A round trip is one assistant message's calls, not a tool call and not a run of adjacent tool
// spans.** Counting calls instead would report a turn that batched four reads as four round trips —
// which is the improvement, scored as the defect.
//
// **Adjacency was the original rule and it was wrong on real transcripts** (joshuafolkken/kit#1406).
// It rested on "tool spans sit adjacent exactly when their calls were issued together in one turn",
// and Claude Code does not write a turn that way: each `tool_use` block is its own assistant line and
// the harness returns each result as soon as it has one, so a turn issuing three calls is written
// `use → result → use → result → use → result`. Every result is separated from the next by that same
// turn's own model span, so the adjacency rule scored one batched turn as three unbatched ones.
// Measured on run #1399, whose transcript has 8 turns issuing more than one call: the report said
// `3 batched turns / 44 single-call` over 47 round trips where the run made 40 — and the same 7
// phantom trips were then counted by `time-bundles.ts` as work that *could* be batched, recommending
// the very batching the turn had already done.
//
// **So the turn is read off the message id, which `time-spans.ts` now carries on every span.** Where
// a span carries none — an unmatched result, an assistant line written without an id — the adjacency
// rule stands as the fallback it always was, so a transcript shape that never wrote ids measures
// exactly as it did before rather than degrading to one trip per call.
//
// ## The three quantities this module and `time-report.ts` define
//
// - **`turn_count`** — how many assistant *messages* the run's spans came from. Not lines: one turn
//   that thought and then issued two calls is three lines carrying one id, and run #1399's 41 turns
//   were reported as 79 before this was fixed.
// - **`round_trip_count`** — how many times the run stopped and waited for tool results. One per
//   message that issued at least one call, so it is at most `turn_count` and at most
//   `tool_call_count`.
// - **`categories.model_ms`** — the wall clock spent with the model composing, defined in
//   `time-report.ts` as the total duration of every model span. It is a *duration* over the same
//   lines `turn_count` counts, so splitting a message across lines never changed it — which is why
//   the model share was right on run #1399 while the turn count was not.

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
function is_call(span: Span): boolean {
	return is_tool(span) && !span.is_continuation
}

function count_calls(spans: ReadonlyArray<Span>): number {
	return spans.filter((span) => is_call(span)).length
}

// The nearest span before this one that is not a model span, or `undefined` where none is.
// **The walk back crosses model spans and stops at everything else** (joshuafolkken/kit#1406): a
// turn's own calls are separated only by its own model spans, while a human wait means the next turn
// was composed after an interruption and a continuation means a delegated unit ran in between —
// neither of which any message could have issued its calls across. A human span that stops the walk
// carries no message id, so it can never be mistaken for the same turn.
function previous_break(spans: ReadonlyArray<Span>, index: number): Span | undefined {
	for (let back = index - 1; back >= 0; back -= 1) {
		const span = spans[back]

		if (span === undefined || !is_model(span)) return span
	}

	return undefined
}

// Whether this call belongs to the same turn as the one before it. **An absent id joins nothing**:
// every span lacking one shares the empty string, so treating it as a group would fold a run's
// unmatched results into a single round trip spanning the whole file — the same reason
// `time-density.ts` refuses to group on it.
function continues_turn(spans: ReadonlyArray<Span>, index: number, message_id: string): boolean {
	if (message_id === time_spans.NO_MESSAGE_ID) return false

	const earlier = previous_break(spans, index)

	return earlier !== undefined && !earlier.is_continuation && earlier.message_id === message_id
}

// **A continuation never opens one either.** The tail of a call whose middle went to a delegated
// unit sits after that unit's spans, and the last of those is the subagent's own turn — a model
// span — so the tail would otherwise read as a fresh call issued alone. Counting it that way moves
// the density in *both* wrong directions at once, one call fewer over one trip more, which is how a
// turn that batched and delegated could print the warning meant for a turn that did neither.
//
// **Two rules, and the adjacency one is the fallback rather than the definition**
// (joshuafolkken/kit#1406). A call issued beside another in the array is the shape the transcript
// writes when the results arrive together, and it stays as it was — including for a span carrying no
// message id at all. Everything else asks the id, which is what catches the shape Claude Code
// actually writes: `use → result → use → result`, one turn, its calls separated by its own model
// spans.
function opens_round_trip(spans: ReadonlyArray<Span>, index: number): boolean {
	const span = spans[index]

	if (span === undefined || !is_tool(span) || span.is_continuation) return false
	if (is_tool_at(spans, index - 1)) return false

	return !continues_turn(spans, index, span.message_id)
}

// The calls of one round trip, as the walk below accumulates them.
interface TripWalk {
	trips: Array<Array<Span>>
	// The trip currently open, or `undefined` where the span just seen closed one. A group of adjacent
	// tool spans headed by a continuation opens none — `opens_round_trip` refuses it — so its calls
	// find no open trip and are attributed to nothing rather than to the trip before them.
	open: Array<Span> | undefined
}

// **A model span no longer closes the open trip** (joshuafolkken/kit#1406). It is what sits between
// two calls of one turn, so closing on it left the turn's second call with no trip to join and the
// per-tool counts reporting a batched turn as a run of solitary calls. What still closes one is a
// human wait: the turn after it was composed after an interruption, so its calls belong to a trip of
// their own even where `opens_round_trip` declined to open one.
function open_trip(walk: TripWalk): void {
	walk.open = []
	walk.trips.push(walk.open)
}

function place_call(walk: TripWalk, span: Span): void {
	if (is_call(span)) walk.open?.push(span)
}

function step_trip(walk: TripWalk, span: Span, is_opener: boolean): void {
	if (is_opener) open_trip(walk)

	if (is_tool(span)) place_call(walk, span)
	else if (!is_model(span)) walk.open = undefined
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

// One per group: the first call of each turn, plus each call the fallback rule found beside another.
function count_round_trips(spans: ReadonlyArray<Span>): number {
	return group_round_trips(spans).length
}

// What identifies the turn a model span belongs to. **A span carrying no message id is its own
// turn** rather than joining the id-less bucket: the empty string is shared by every such span, and
// folding them would report a whole transcript written without ids as a single turn.
function turn_key(span: Span, index: number): string {
	return span.message_id === time_spans.NO_MESSAGE_ID ? `#${String(index)}` : span.message_id
}

// **How many assistant messages the run's model spans came from — the definition of a turn**
// (joshuafolkken/kit#1406). Not how many model spans there are: Claude Code writes one line per
// content block and repeats the message id on each, so a turn that thought and then issued two calls
// is three lines and three model spans. Counting the spans reported run #1399's 41 turns as 79, and
// with them halved every per-turn figure divided by this — `josh time --epic`'s `ms_per_turn` above
// all.
function count_turns(spans: ReadonlyArray<Span>): number {
	const keys = spans.filter((span) => is_model(span)).map((span, index) => turn_key(span, index))

	return new Set(keys).size
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
	// Exported since joshuafolkken/kit#1406, so a turn is defined in the one module that already
	// defines a round trip rather than as a span filter in the report next door.
	count_turns,
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
	// The four below are exported since joshuafolkken/kit#1406, when the model-gap walk moved to
	// `time-model-gaps.ts` and needed the same predicates and the same opener test this walk uses. A
	// private copy there would be the clone `CLAUDE.md` prohibits, in the one place a drift would have
	// the distribution and the count disagreeing about what a round trip is.
	is_call,
	is_model,
	opens_round_trip,
	per_round_trip,
	started_ms,
}

export { time_round_trips }
