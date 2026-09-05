import { describe, expect, it } from 'vitest'
import { time_bundles } from './time-bundles'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const MODEL = time_span_fixture.span(time_spans.MODEL_CATEGORY)
const HUMAN = time_span_fixture.span(time_spans.HUMAN_CATEGORY)
const PRICE = { round_trip_count: 6, model_ms_per_round_trip: 8800 }
// The assistant message a turn's spans all carry (joshuafolkken/kit#1406).
const TURN = 'msg-1'

// One call of a single-call turn. The two fields the grouping reads are the two `time-bundle-call.ts`
// puts on the span; everything else about it is the shared fixture's.
function call(targets: Array<string>, is_bundleable = true): Span {
	return { ...time_span_fixture.span(time_spans.TOOL_CATEGORY), is_bundleable, targets }
}

// The same call, tagged with the turn that issued it (joshuafolkken/kit#1406).
function call_of(message_id: string, target: string): Span {
	return { ...call([target]), message_id }
}

// A turn that composed and then issued one call, which is the pair the walk reads as one round trip.
function turn_of(message_id: string, target: string): Array<Span> {
	return [{ ...MODEL, message_id }, call_of(message_id, target)]
}

describe('time_bundles.build_bundles — what counts as a sequence', () => {
	it('reads consecutive single-call turns with disjoint targets as one sequence', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), MODEL, call(['c.ts'])]
		const totals = time_bundles.build_bundles(spans)

		expect(totals.sequence_count).toBe(1)
		expect(totals.longest_sequence).toBe(3)
		expect(totals.recoverable_round_trips).toBe(2)
	})

	// A person typing means the second turn was composed after an interruption, so the two calls could
	// never have gone out together however independent they look.
	it('breaks a sequence at a human wait', () => {
		const spans = [MODEL, call(['a.ts']), HUMAN, call(['b.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	// A turn that already batched is the improvement, not the defect, so it is not folded in.
	it('breaks a sequence at a turn that issued several calls', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), call(['c.ts']), MODEL]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	it('breaks a sequence at a call that is not bundleable', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts'], false), MODEL, call(['c.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	// The tail of a call whose middle went to a delegated unit. The unit ran between the two turns, so
	// they were not consecutive at all.
	it('breaks a sequence at the tail of a call split around a delegated unit', () => {
		const tail = { ...call(['b.ts']), is_continuation: true }
		const spans = [MODEL, call(['a.ts']), MODEL, tail, MODEL, call(['c.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})
})

// joshuafolkken/kit#1406. Claude Code writes each `tool_use` block as its own assistant line and the
// harness returns each result as it arrives, so a turn's calls reach the timeline separated by that
// turn's own model spans. Read as several single-call turns, a turn that had already batched was
// offered back as a sequence that could have been bundled — which is where run #1399's whole
// `recoverable round trips 8` came from.
describe('time_bundles.build_bundles — a turn told apart by its message id', () => {
	it('breaks a sequence at a batched turn whose calls arrived one at a time', () => {
		const thinking = { ...MODEL, message_id: TURN }
		const spans = [
			thinking,
			call_of(TURN, 'a.ts'),
			thinking,
			call_of(TURN, 'b.ts'),
			thinking,
			call_of(TURN, 'c.ts'),
			MODEL,
		]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})

	// The counterpart, so the rule above cannot pass by refusing every sequence: three turns of one
	// call each, told apart by their ids rather than by adjacency.
	it('still reads three single-call turns carrying their own ids as one sequence', () => {
		const spans = [...turn_of('m1', 'a.ts'), ...turn_of('m2', 'b.ts'), ...turn_of('m3', 'c.ts')]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(2)
	})

	// `time_overlap.trim` copies the head's fields onto the tail, so the tail carries the very message
	// the turn was issuing from. Read as that turn still issuing calls, it would skip the flush that
	// says a delegated unit ran in between.
	it('breaks a sequence at a tail carrying the message id of the turn it interrupted', () => {
		const tail = { ...call_of(TURN, 'b.ts'), is_continuation: true }
		const spans = [call_of(TURN, 'a.ts'), tail, ...turn_of('m2', 'c.ts')]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(0)
	})
})

describe('time_bundles.build_bundles — the target test', () => {
	// The search-then-read pair: the second call's path sits inside the directory the first one named,
	// which is how it learned the answer.
	it('starts a new sequence where a call reads inside a directory an earlier one named', () => {
		const spans = [MODEL, call(['scripts']), MODEL, call(['scripts/a.ts']), MODEL, call(['b.ts'])]
		const totals = time_bundles.build_bundles(spans)

		expect(totals.sequence_count).toBe(1)
		expect(totals.longest_sequence).toBe(2)
		expect(totals.recoverable_round_trips).toBe(1)
	})

	it('starts a new sequence where two calls name the same path', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['a.ts']), MODEL, call(['b.ts'])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(1)
	})

	// A call naming nothing cannot be shown to depend on anything, which is the direction this figure
	// over-reports in — stated in the module header rather than left to be discovered.
	it('treats calls that name nothing as independent of each other', () => {
		const spans = [MODEL, call([]), MODEL, call([]), MODEL, call([])]

		expect(time_bundles.build_bundles(spans).recoverable_round_trips).toBe(2)
	})
})

describe('time_bundles.build_bundles — measured against unread', () => {
	it('says a run that batched everything was measured and had nothing to recover', () => {
		const totals = time_bundles.build_bundles([MODEL, call(['a.ts']), call(['b.ts'])])

		expect(totals.is_measured).toBe(true)
		expect(totals.recoverable_round_trips).toBe(0)
	})

	it('says a run whose transcript was never read measured nothing', () => {
		expect(time_bundles.build_bundles([]).is_measured).toBe(false)
	})
})

describe('time_bundles.bundle_lines', () => {
	it('prints the sequences, the trips they hold and what the model wait would return', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), MODEL, call(['c.ts'])]
		const totals = time_bundles.build_bundles(spans)
		const text = time_bundles.bundle_lines(totals, PRICE).join('\n')

		expect(text).toContain(time_bundles.HEADING)
		expect(text).toContain('longest 3 turn(s)')
		expect(text).toContain('33.3% of 6 round trip(s)')
		expect(text).toContain('0.3 min')
	})

	// A transcript that was read and called no tool has no share and no price. Printed as measured, the
	// block would say `at 0.0 s model time per round trip` beside a round-trip price row already saying
	// there was nothing to divide by — one report disagreeing with itself.
	it('says there was nothing to divide where the run made no round trip', () => {
		const totals = time_bundles.build_bundles([MODEL])
		const text = time_bundles
			.bundle_lines(totals, { round_trip_count: 0, model_ms_per_round_trip: 0 })
			.join('\n')

		expect(totals.is_measured).toBe(true)
		expect(text).toContain('no tool call to divide')
		expect(text).not.toContain('per round trip')
	})

	// Zero here would read as a run that batched everything, which is the one answer an unread
	// transcript cannot support.
	it('withholds every row where no span was read', () => {
		const lines = time_bundles.bundle_lines(time_bundles.NO_BUNDLES, PRICE)

		expect(lines.join('\n')).toContain('not measured')
		expect(lines.join('\n')).not.toContain('round trip(s)')
	})
})

// The sequence the walk is still inside when the spans run out, which is what the live guard asks for
// (joshuafolkken/kit#1390). `build_bundles` closes the walk because it prices a run that has ended;
// this one is deliberately left open.
describe('time_bundles.open_sequence', () => {
	it('returns the run of single-call turns the next call would extend', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), MODEL]

		expect(time_bundles.open_sequence(spans).map((span) => span.targets)).toEqual([
			['a.ts'],
			['b.ts'],
		])
	})

	// A turn that already batched is the improvement rather than the defect, so nothing before it is
	// carried across.
	it('is empty where the last turn issued several calls', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['b.ts']), call(['c.ts']), MODEL]

		expect(time_bundles.open_sequence(spans)).toEqual([])
	})

	// A conflicting call starts a new sequence at itself rather than ending the run, because everything
	// after it may still have been bundleable with it.
	it('restarts at a call that names a target the sequence already touched', () => {
		const spans = [MODEL, call(['a.ts']), MODEL, call(['a.ts']), MODEL]

		expect(time_bundles.open_sequence(spans)).toHaveLength(1)
	})
})
