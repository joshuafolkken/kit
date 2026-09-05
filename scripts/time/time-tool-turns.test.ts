import { describe, expect, it } from 'vitest'
import { time_report } from './time-report'
import { time_report_fixture } from './time-report-fixture'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'
import { time_tool_turns, type ToolTurnCounts } from './time-tool-turns'

const { span } = time_span_fixture
const MODEL = span(time_spans.MODEL_CATEGORY)
const HUMAN = span(time_spans.HUMAN_CATEGORY)
const EDIT_LABEL = 'Edit'
const READ_LABEL = 'Read'
const EDIT = span(time_spans.TOOL_CATEGORY, 1, EDIT_LABEL)
const READ = span(time_spans.TOOL_CATEGORY, 1, READ_LABEL)
const CONTINUATION = { ...READ, is_continuation: true }

// The shape run #1379 actually had: every `Edit` in a turn of its own, four of them.
const EDITS_ALONE = [MODEL, EDIT, MODEL, EDIT, MODEL, EDIT, MODEL, EDIT]
// The same four calls where two turns issued a pair each.
const EDITS_BATCHED = [MODEL, EDIT, EDIT, MODEL, EDIT, EDIT]

function counts_of(spans: ReadonlyArray<Span>, label: string): ToolTurnCounts | undefined {
	return time_tool_turns.build_turns(spans).by_label.get(label)
}

describe('time_tool_turns.build_turns — per tool', () => {
	// The first acceptance criterion of joshuafolkken/kit#1385, read on the shape it was filed about:
	// the row has to be able to say `4 calls / 4 round trips / 4 alone`.
	it('charges a tool one round trip per turn and counts the calls that went out alone', () => {
		expect(counts_of(EDITS_ALONE, EDIT_LABEL)).toEqual({
			round_trip_count: 4,
			alone_in_turn_count: 4,
		})
	})

	// The second acceptance criterion: on a run that batched, the alone count falls below the call
	// count — which is what makes the column a finding rather than a restatement of `call_count`.
	it('leaves a batched call out of the alone count', () => {
		expect(counts_of(EDITS_BATCHED, EDIT_LABEL)).toEqual({
			round_trip_count: 2,
			alone_in_turn_count: 0,
		})
	})

	// Two calls of one tool in one turn consumed one round trip between them. Counting each call would
	// make the column sum past the run's own round-trip count, which is the number it is read against.
	it('counts one round trip for a tool called twice in the same turn', () => {
		const turns = time_tool_turns.build_turns([MODEL, EDIT, EDIT])

		expect(turns.by_label.get(EDIT_LABEL)?.round_trip_count).toBe(1)
	})

	// A turn issuing two different tools charges the trip to both, and neither of them was alone in it.
	it('charges a shared turn to every tool that called in it', () => {
		const turns = time_tool_turns.build_turns([MODEL, EDIT, READ])

		expect(turns.by_label.get(EDIT_LABEL)).toEqual({ round_trip_count: 1, alone_in_turn_count: 0 })
		expect(turns.by_label.get(READ_LABEL)).toEqual({ round_trip_count: 1, alone_in_turn_count: 0 })
	})

	// A continuation is the tail of one call, not a second one — `count_calls` already refuses to count
	// it, and a row that counted it here would report a round trip the run never made.
	it('does not charge a round trip to the tail of a call split around a delegated unit', () => {
		const turns = time_tool_turns.build_turns([MODEL, READ, MODEL, CONTINUATION])

		expect(turns.by_label.get(READ_LABEL)).toEqual({ round_trip_count: 1, alone_in_turn_count: 1 })
	})
})

describe('time_tool_turns.build_turns — the run split', () => {
	it('separates the turns that issued several calls from the turns that issued one', () => {
		expect(time_tool_turns.build_turns([MODEL, EDIT, READ, MODEL, EDIT]).split).toEqual({
			batched_turn_count: 1,
			single_call_turn_count: 1,
		})
	})

	// The two halves sum to the round-trip count the report prints beside them, which is the
	// cross-check the row exists to be read against.
	it('sums to the run round-trip count', () => {
		const { split } = time_tool_turns.build_turns(EDITS_BATCHED)

		expect(split.batched_turn_count + split.single_call_turn_count).toBe(2)
	})

	it('counts neither shape where no tool was called', () => {
		expect(time_tool_turns.build_turns([MODEL, HUMAN]).split).toEqual(time_tool_turns.NO_TURN_SPLIT)
	})
})

describe('time_tool_turns.with_turn_counts', () => {
	it('merges each row with the counts of its own label', () => {
		const { by_label } = time_tool_turns.build_turns(EDITS_ALONE)
		const merged = time_tool_turns.with_turn_counts([{ label: EDIT_LABEL }], by_label)

		expect(merged).toEqual([{ label: EDIT_LABEL, round_trip_count: 4, alone_in_turn_count: 4 }])
	})

	// A label that called nothing countable really did consume no round trip. The withholding this
	// report does is one level up, on whether any span was read at all.
	it('gives a row no counts were measured for a measured zero', () => {
		const merged = time_tool_turns.with_turn_counts([{ label: 'Task' }], new Map())

		expect(merged).toEqual([{ label: 'Task', round_trip_count: 0, alone_in_turn_count: 0 }])
	})
})

// The same two counts as the report prints them. They live beside the aggregation rather than in
// `time-report.test.ts`, which is at its length ceiling — the seam `time-report-fixture.ts` was cut
// along, and the one that keeps a feature's cases in one file.
const { MINUTE_MS, MIXED, build, line_of, run_report } = time_report_fixture
// The same three calls one turn issued, and then one call in a turn of its own.
const ONE_ALONE = [...MIXED, MODEL, EDIT]

describe('time_report — which tool consumed the round trips', () => {
	// The suffix is matched rather than the row's label, because a segment row names the busiest tool
	// inside it and would answer a search for the label with a line this case is not about.
	it('prints each tool row with the trips it consumed and the calls that went out alone', () => {
		expect(time_report.format_report(build(ONE_ALONE))).toContain(
			'1 call(s) · 1 round trip(s) · 1 alone',
		)
	})

	it('prints no alone call for a tool whose every call was batched', () => {
		expect(time_report.format_report(build(MIXED))).toContain(
			'1 call(s) · 1 round trip(s) · 0 alone',
		)
	})

	it('splits the turns that issued several calls from the ones that issued a single call', () => {
		const report = build(ONE_ALONE)
		const line = line_of(time_report.format_report(report), time_report.BATCHED_TURNS_LABEL)

		expect(report.batched_turn_count).toBe(1)
		expect(report.single_call_turn_count).toBe(1)
		expect(line).toContain('1 single-call turn(s)')
	})

	// The third acceptance criterion: nothing was read, so the split is an unknown rather than a run
	// that batched nothing — the same answer, in the same words, the counts above it give.
	it('withholds the turn split where no span was read', () => {
		const text = time_report.format_report(run_report([], MINUTE_MS))

		expect(line_of(text, time_report.BATCHED_TURNS_LABEL)).toContain(time_report.NOT_MEASURED)
		expect(text).not.toContain('single-call turn(s)')
	})
})
