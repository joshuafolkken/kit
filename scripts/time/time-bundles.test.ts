import { describe, expect, it } from 'vitest'
import { time_bundles } from './time-bundles'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const MODEL = time_span_fixture.span(time_spans.MODEL_CATEGORY)
const HUMAN = time_span_fixture.span(time_spans.HUMAN_CATEGORY)
const PRICE = { round_trip_count: 6, model_ms_per_round_trip: 8800 }

// One call of a single-call turn. The two fields the grouping reads are the two `time-bundle-call.ts`
// puts on the span; everything else about it is the shared fixture's.
function call(targets: Array<string>, is_bundleable = true): Span {
	return { ...time_span_fixture.span(time_spans.TOOL_CATEGORY), is_bundleable, targets }
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

	// Zero here would read as a run that batched everything, which is the one answer an unread
	// transcript cannot support.
	it('withholds every row where no span was read', () => {
		const lines = time_bundles.bundle_lines(time_bundles.NO_BUNDLES, PRICE)

		expect(lines.join('\n')).toContain('not measured')
		expect(lines.join('\n')).not.toContain('round trip(s)')
	})
})
