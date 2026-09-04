import { describe, expect, it } from 'vitest'
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

describe('time_round_trips.issuing_model_ms', () => {
	// Both model spans issued a round trip, so both are charged: one turn batched three calls and the
	// next issued one.
	it('charges the model time of every turn that opened a round trip', () => {
		expect(time_round_trips.issuing_model_ms(BATCHED)).toBe(2 * time_span_fixture.MINUTE_MS)
	})

	// The two spans before the call are one turn's composition and are charged; the one after it went
	// to an answer, and charging it would price each round trip above what cutting one returns.
	it('leaves out the model time of a turn that called nothing', () => {
		expect(time_round_trips.issuing_model_ms(ANSWERED)).toBe(2 * time_span_fixture.MINUTE_MS)
	})

	it('charges nothing where no round trip was opened', () => {
		expect(time_round_trips.issuing_model_ms([MODEL, HUMAN])).toBe(0)
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
