import { describe, expect, it } from 'vitest'
import { time_model_gaps } from './time-model-gaps'
import { time_round_trips } from './time-round-trips'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const MODEL = time_span_fixture.span(time_spans.MODEL_CATEGORY)
const TOOL = time_span_fixture.span(time_spans.TOOL_CATEGORY)
const HUMAN = time_span_fixture.span(time_spans.HUMAN_CATEGORY)
// The second half of a call whose middle went to a delegated unit, as `time_overlap.trim` hands it
// back: one call, two spans.
const CONTINUATION = { ...TOOL, is_continuation: true }

// A one-minute span opening at the given minute, for the cases that turn on when a span sat rather
// than on how long it took.
function at_minute(category: Span['category'], minute: number): Span {
	const { MINUTE_MS } = time_span_fixture

	return { ...time_span_fixture.span(category), ended_ms: (minute + 1) * MINUTE_MS }
}

// One turn issuing three calls at once, then one issuing a single call.
const BATCHED = [MODEL, TOOL, TOOL, TOOL, MODEL, TOOL]
// The same four calls, each in a turn of its own — the shape every run measured on
// joshuafolkken/kit#1304 actually had.
const SERIAL = [MODEL, TOOL, MODEL, TOOL, MODEL, TOOL, MODEL, TOOL]

describe('time_round_trips.count_round_trips', () => {
	it('counts adjacent tool spans as one round trip', () => {
		expect(time_round_trips.count_round_trips(BATCHED)).toBe(2)
	})

	it('counts a tool span per turn as a round trip each', () => {
		expect(time_round_trips.count_round_trips(SERIAL)).toBe(4)
	})

	// The first span of an array has no predecessor, and a transcript can open on a tool result when
	// the previous session ended mid-turn.
	it('starts a round trip on a leading tool span', () => {
		expect(time_round_trips.count_round_trips([TOOL, TOOL, MODEL])).toBe(1)
	})

	it('reopens a round trip after a human wait, not only after a turn', () => {
		expect(time_round_trips.count_round_trips([TOOL, HUMAN, TOOL])).toBe(2)
	})

	it('counts none where no tool was called', () => {
		expect(time_round_trips.count_round_trips([MODEL, HUMAN])).toBe(0)
	})

	// A delegating turn, in the order `in_time_order` puts it: the call's leading fragment, the unit's
	// own work — whose last span is the subagent's turn — and then the call's tail. The tail is not a
	// second call, so it does not open a second round trip either.
	it('does not open a round trip on the tail of a call split around a delegated unit', () => {
		expect(time_round_trips.count_round_trips([MODEL, TOOL, MODEL, CONTINUATION])).toBe(1)
	})
})

// A run's spans do not arrive in time order: `time_overlap.resolve_delegated` appends the delegated
// ones after the parent's, and `time_corpus` concatenates one session after another. These two tool
// spans are two turns apart in time and adjacent in the array.
const OUT_OF_ORDER = [
	at_minute(time_spans.TOOL_CATEGORY, 0),
	at_minute(time_spans.TOOL_CATEGORY, 2),
	at_minute(time_spans.MODEL_CATEGORY, 1),
]

describe('time_round_trips.count_round_trips — ordering', () => {
	it('orders the spans by when they opened rather than trusting the array', () => {
		expect(time_round_trips.count_round_trips(OUT_OF_ORDER)).toBe(2)
	})
})

// joshuafolkken/kit#1385. The per-tool counts are read off these groups, so the grouping and the
// count have to be the same walk — a second one beside it is where the two would come to disagree
// about what a round trip is.
describe('time_round_trips.group_round_trips', () => {
	it('returns one group per round trip, holding the calls that turn issued', () => {
		expect(time_round_trips.group_round_trips(BATCHED).map((trip) => trip.length)).toEqual([3, 1])
	})

	it('agrees with the count it is the length of', () => {
		for (const spans of [BATCHED, SERIAL, OUT_OF_ORDER, [TOOL, HUMAN, TOOL], [MODEL, HUMAN]]) {
			expect(time_round_trips.group_round_trips(spans)).toHaveLength(
				time_round_trips.count_round_trips(spans),
			)
		}
	})

	// One call bracketing a delegated unit comes back as two spans, and the tail is not a call. A group
	// holding it would report the turn as having issued one more than it did.
	it('leaves the tail of a split call out of every group', () => {
		const trips = time_round_trips.group_round_trips([MODEL, TOOL, MODEL, CONTINUATION])

		expect(trips.map((trip) => trip.length)).toEqual([1])
	})
})

describe('time_round_trips.count_calls', () => {
	// The call count is what the two shapes agree on; the round trips are what they differ by, which
	// is the whole reason both are reported rather than one.
	it('counts every tool span whether or not it was batched', () => {
		expect(time_round_trips.count_calls(BATCHED)).toBe(4)
		expect(time_round_trips.count_calls(SERIAL)).toBe(4)
	})

	// One call bracketing a delegated unit comes back as two spans. Counting both would report more
	// calls than the run made, inflating the density — the direction that hides the warning.
	it('does not count the continuation of a split call as a second call', () => {
		expect(time_round_trips.count_calls([MODEL, TOOL, CONTINUATION])).toBe(1)
	})
})

// A turn that ends in a reply rather than a call: its model time bought no round trip, so batching
// could never give it back. The last model span here is followed by a human wait, which is exactly
// the shape of a run stopping to answer.
const ANSWERED = [MODEL, MODEL, TOOL, MODEL, HUMAN]

describe('time_model_gaps.issuing_model_ms', () => {
	// Both model spans issued a round trip, so both are charged: one turn batched three calls and the
	// next issued one.
	it('charges the model time of every turn that opened a round trip', () => {
		expect(time_model_gaps.issuing_model_ms(BATCHED)).toBe(2 * time_span_fixture.MINUTE_MS)
	})

	// The two spans before the call are one turn's composition and are charged; the one after it went
	// to an answer, and charging it would price each round trip above what cutting one returns.
	it('leaves out the model time of a turn that called nothing', () => {
		expect(time_model_gaps.issuing_model_ms(ANSWERED)).toBe(2 * time_span_fixture.MINUTE_MS)
	})

	it('charges nothing where no round trip was opened', () => {
		expect(time_model_gaps.issuing_model_ms([MODEL, HUMAN])).toBe(0)
	})

	// A call whose middle went to a delegated unit: the lead, the unit's own work ending in the
	// subagent's closing turn, the tail that opens no round trip, and then the parent's next call.
	// Carrying the pending time across that tail would charge the subagent's answer to the parent's
	// next trip — the over-pricing this whole function exists to remove, one level down.
	it("does not carry a delegated unit's answer past the tail of the call that bracketed it", () => {
		const spans = [MODEL, TOOL, MODEL, CONTINUATION, MODEL, TOOL]

		expect(time_model_gaps.issuing_model_ms(spans)).toBe(2 * time_span_fixture.MINUTE_MS)
	})
})

// The stretches the mean above is the mean of (joshuafolkken/kit#1386).
describe('time_model_gaps.issuing_model_gaps', () => {
	// **One stretch per round trip, so the distribution and the mean share a denominator.** A walk that
	// produced fewer would put the spread above the price the report prints beside it.
	it('hands back one stretch for every round trip the run made', () => {
		expect(time_model_gaps.issuing_model_gaps(SERIAL)).toHaveLength(
			time_round_trips.count_round_trips(SERIAL),
		)
		expect(time_model_gaps.issuing_model_gaps(BATCHED)).toHaveLength(
			time_round_trips.count_round_trips(BATCHED),
		)
	})

	// The mean is defined as the sum of these, rather than folded separately — which is what stops the
	// two from coming to disagree about what was charged.
	it('sums to exactly the issuing model time', () => {
		const total = time_model_gaps
			.issuing_model_gaps(ANSWERED)
			.reduce((sum, gap) => sum + gap.duration_ms, 0)

		expect(total).toBe(time_model_gaps.issuing_model_ms(ANSWERED))
	})

	// A round trip opened with nothing pending is a stretch of zero, not a stretch that did not happen:
	// the leading tool span here had no turn in front of it at all.
	it('records a round trip nothing preceded as a stretch of zero', () => {
		const [first] = time_model_gaps.issuing_model_gaps([TOOL, MODEL, TOOL])

		expect(first?.duration_ms).toBe(0)
		expect(first?.started_ms).toBe(first?.ended_ms)
	})

	// **The window ends where the stretch's last span ended, not where its durations add up to.** Two
	// turns from different sessions are consecutive in the array with real time between them, and a
	// window measured as a start plus a sum would send a reader back to the wrong turn.
	it('closes the window at the last span of the stretch, across a gap in the timeline', () => {
		const { MINUTE_MS } = time_span_fixture
		const spans = [
			{ ...MODEL, ended_ms: MINUTE_MS },
			{ ...MODEL, ended_ms: 10 * MINUTE_MS },
			{ ...TOOL, ended_ms: 11 * MINUTE_MS },
		]
		const [only] = time_model_gaps.issuing_model_gaps(spans)

		expect(only?.duration_ms).toBe(2 * MINUTE_MS)
		expect(only?.ended_ms).toBe(10 * MINUTE_MS)
	})
})

// joshuafolkken/kit#1406. Claude Code writes each `tool_use` block as its own assistant line and the
// harness returns each result as it arrives, so one turn issuing three calls reaches the timeline as
// `use → result → use → result → use → result` — every call separated from the next by that same
// turn's own model span.
const TURN = 'msg-1'
const NEXT_TURN = 'msg-2'

function in_turn(span: Span, message_id: string): Span {
	return { ...span, message_id }
}

const INTERLEAVED = [
	in_turn(MODEL, TURN),
	in_turn(TOOL, TURN),
	in_turn(MODEL, TURN),
	in_turn(TOOL, TURN),
	in_turn(MODEL, TURN),
	in_turn(TOOL, TURN),
]

describe('time_round_trips.count_round_trips — one turn, whatever order its results arrived in', () => {
	// The run stopped once, so it made one round trip. Measured on run #1399, which the adjacency rule
	// read as 47 round trips where the run made 40.
	it('counts a turn whose calls arrived one at a time as one round trip', () => {
		expect(time_round_trips.count_round_trips(INTERLEAVED)).toBe(1)
	})

	it('holds all three calls in that one group', () => {
		expect(time_round_trips.group_round_trips(INTERLEAVED).map((trip) => trip.length)).toEqual([3])
	})

	it('opens a round trip where the next call belongs to the next turn', () => {
		const spans = [
			in_turn(MODEL, TURN),
			in_turn(TOOL, TURN),
			in_turn(MODEL, NEXT_TURN),
			in_turn(TOOL, NEXT_TURN),
		]

		expect(time_round_trips.count_round_trips(spans)).toBe(2)
	})

	// A person typed between the two, so the second turn was composed after an interruption whatever
	// id the transcript repeated on it.
	it('reopens a round trip across a human wait', () => {
		const spans = [in_turn(TOOL, TURN), HUMAN, in_turn(TOOL, TURN)]

		expect(time_round_trips.count_round_trips(spans)).toBe(2)
	})

	// **The adjacency rule is the fallback, not the definition.** The very same shape carrying no
	// message id measures exactly as it did before this change, so a transcript that never wrote one
	// is not silently re-scored to a round trip per call.
	it('falls back to adjacency where the transcript wrote no message id', () => {
		// Three calls with nothing to group them by, read exactly as they were before this change.
		expect(time_round_trips.count_round_trips([MODEL, TOOL, MODEL, TOOL, MODEL, TOOL])).toBe(3)
	})
})

describe('time_model_gaps.issuing_model_gaps — a turn that issued several calls', () => {
	// **One stretch, holding the whole turn's model time.** A round trip is a whole turn, so its price
	// is everything that turn composed — including what it wrote between its second and third call.
	// Charging only the part before the first call priced a batched turn below what removing it returns,
	// and both the bundling and single-check blocks multiply that price out as a saving.
	it('charges the composing between a turn own calls to the trip it opened', () => {
		const gaps = time_model_gaps.issuing_model_gaps(INTERLEAVED)

		expect(gaps).toHaveLength(1)
		expect(time_model_gaps.issuing_model_ms(INTERLEAVED)).toBe(3 * time_span_fixture.MINUTE_MS)
	})

	// The invariant the distribution and the mean share: still one stretch per round trip, so the spread
	// cannot come to sit above the price printed beside it.
	it('still hands back one stretch for every round trip', () => {
		expect(time_model_gaps.issuing_model_gaps(INTERLEAVED)).toHaveLength(
			time_round_trips.count_round_trips(INTERLEAVED),
		)
	})
})

describe('time_round_trips.count_turns', () => {
	// One turn that thought and then issued three calls is seven spans and one turn. Counting the
	// model spans instead reported run #1399's 41 turns as 79.
	it('counts one turn per assistant message rather than per model span', () => {
		expect(time_round_trips.count_turns(INTERLEAVED)).toBe(1)
	})

	it('counts a turn for each distinct message', () => {
		const spans = [in_turn(MODEL, TURN), in_turn(TOOL, TURN), in_turn(MODEL, NEXT_TURN)]

		expect(time_round_trips.count_turns(spans)).toBe(2)
	})

	// A span carrying no id is its own turn: every one of them shares the empty string, and folding
	// them would report a transcript written without ids as a single turn.
	it('counts a model span carrying no message id as a turn of its own', () => {
		expect(time_round_trips.count_turns([MODEL, MODEL, TOOL])).toBe(2)
	})

	it('counts no turn where nothing but tools and waits were read', () => {
		expect(time_round_trips.count_turns([TOOL, HUMAN])).toBe(0)
	})
})

describe('time_round_trips.per_round_trip', () => {
	it('divides the calls by the trips they were issued in', () => {
		expect(time_round_trips.per_round_trip(4, 2)).toBe(2)
	})

	// The same divisor priced in milliseconds (joshuafolkken/kit#1307): ten minutes of run over four
	// round trips is two and a half minutes each, which is the figure a proposed cut is multiplied by.
	it('prices one round trip from a duration and the trips it was spread over', () => {
		expect(time_round_trips.per_round_trip(10 * time_span_fixture.MINUTE_MS, 4)).toBe(
			2.5 * time_span_fixture.MINUTE_MS,
		)
	})

	// Nothing was read, so there is no density and no price — dividing would assert a measurement
	// nobody took, in whichever unit the numerator carried.
	it('answers zero rather than dividing by no round trips', () => {
		expect(time_round_trips.per_round_trip(0, 0)).toBe(0)
		expect(time_round_trips.per_round_trip(10 * time_span_fixture.MINUTE_MS, 0)).toBe(0)
	})
})

describe('time_round_trips.is_below_floor', () => {
	it('flags a run issuing about one call per turn', () => {
		expect(time_round_trips.is_below_floor(1.13)).toBe(true)
	})

	it('passes a run that batches', () => {
		expect(time_round_trips.is_below_floor(2)).toBe(false)
	})

	// A density of zero is the unmeasured answer above, not the worst possible batching — flagging it
	// would report a transcript nobody read as a run that refused to batch.
	it('does not flag an unmeasured scope', () => {
		expect(time_round_trips.is_below_floor(0)).toBe(false)
	})
})
