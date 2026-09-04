import { describe, expect, it } from 'vitest'
import { time_failures } from './time-failures'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const { MINUTE_MS, span, outcome_span } = time_span_fixture
const { OK_OUTCOME, FAILED_OUTCOME, UNKNOWN_OUTCOME } = time_spans
const GATE = 'josh gate'
const LINT = 'josh lint'
const PNPM_LABEL = 'Bash: pnpm'

function gate(end_minute: number, outcome: Span['outcome']): Span {
	return outcome_span(end_minute, outcome, PNPM_LABEL, GATE)
}

// The sequence the issue was filed from, in miniature: a gate that failed, a fix, the same gate run
// again, and unrelated calls around both. One minute each, so a miscounted call is a whole minute.
const MIXED = [
	outcome_span(1, OK_OUTCOME, 'Read'),
	gate(2, FAILED_OUTCOME),
	outcome_span(3, OK_OUTCOME, 'Edit'),
	gate(4, OK_OUTCOME),
	outcome_span(5, OK_OUTCOME, 'Bash: gh'),
]

describe('time_failures.build_failures — a run of successes and failures', () => {
	it('counts the calls that failed and charges the next attempt to re-running them', () => {
		const totals = time_failures.build_failures(MIXED)

		expect(totals.failed_call_count).toBe(1)
		expect(totals.rerun_ms).toBe(MINUTE_MS)
		expect(totals.is_measured).toBe(true)
	})

	// Two failures before a pass is two re-runs, not one: the second attempt and the third were both
	// paid for by a failure, and reporting one would halve the rework the run actually did.
	it('charges every attempt that followed a failure, not just the one that passed', () => {
		const totals = time_failures.build_failures([
			gate(1, FAILED_OUTCOME),
			gate(2, FAILED_OUTCOME),
			gate(3, OK_OUTCOME),
		])

		expect(totals.failed_call_count).toBe(2)
		expect(totals.rerun_ms).toBe(2 * MINUTE_MS)
	})

	// A command run twice by design — the gate runs once beside the review and again over the bumped
	// tree — is not rework, and counting repeats alone would charge that to failure.
	it('charges nothing where a command was simply run twice', () => {
		expect(time_failures.build_failures([gate(1, OK_OUTCOME), gate(2, OK_OUTCOME)]).rerun_ms).toBe(
			0,
		)
	})

	// A run's spans do not arrive in time order: a delegated unit's are appended after the parent's,
	// and `time_corpus` concatenates one session after another. Walked in array order, the pass would
	// come before the failure and no re-run would be seen at all.
	it('orders the spans before it walks them', () => {
		const totals = time_failures.build_failures([gate(4, OK_OUTCOME), gate(2, FAILED_OUTCOME)])

		expect(totals.rerun_ms).toBe(MINUTE_MS)
	})
})

describe('time_failures.build_failures — what belongs to one chain', () => {
	// `Bash: pnpm` alone would put every josh subcommand in one chain, so a lint run after a failed
	// gate would be reported as the gate's re-run.
	it('keeps each josh subcommand in its own chain', () => {
		const totals = time_failures.build_failures([
			gate(1, FAILED_OUTCOME),
			outcome_span(2, OK_OUTCOME, PNPM_LABEL, LINT),
		])

		expect(totals.failed_call_count).toBe(1)
		expect(totals.rerun_ms).toBe(0)
	})

	// Every call whose `tool_use` line was never written carries the same label, so one chain would
	// hold calls of unrelated tools and answer a failed one with whichever came next.
	it('puts a call the transcript could not name in no chain, but still counts it', () => {
		const totals = time_failures.build_failures([
			outcome_span(1, FAILED_OUTCOME, time_spans.UNKNOWN_TOOL),
			outcome_span(2, OK_OUTCOME, time_spans.UNKNOWN_TOOL),
		])

		expect(totals.failed_call_count).toBe(1)
		expect(totals.rerun_ms).toBe(0)
	})

	// The span that closes a model turn or a typed prompt is not a call and has no outcome to have.
	it('reads only tool spans, never the model and human waits between them', () => {
		const totals = time_failures.build_failures([
			span(time_spans.MODEL_CATEGORY, 5),
			gate(6, FAILED_OUTCOME),
			span(time_spans.HUMAN_CATEGORY, 9),
			gate(10, OK_OUTCOME),
		])

		expect(totals.failed_call_count).toBe(1)
		expect(totals.rerun_ms).toBe(MINUTE_MS)
	})
})

// One call bracketing a delegated unit comes back from `time_overlap.trim` as a head and a tail, and
// the two halves need opposite answers: the tail's time is the call's, its count is not.
describe('time_failures.build_failures — a call split around a delegated unit', () => {
	// **Charging only the head** would price the re-run at seconds while the minutes it really took
	// stay in the `tool execution` the share is quoted against.
	it('charges the whole of a re-run whose middle went to a delegated unit', () => {
		const tail = { ...gate(9, OK_OUTCOME), is_continuation: true, duration_ms: 5 * MINUTE_MS }
		const totals = time_failures.build_failures([
			gate(1, FAILED_OUTCOME),
			gate(2, OK_OUTCOME),
			tail,
		])

		expect(totals.rerun_ms).toBe(6 * MINUTE_MS)
	})

	it('counts that continuation as part of the call rather than as a second one', () => {
		const tail = { ...gate(9, FAILED_OUTCOME), is_continuation: true }

		expect(time_failures.build_failures([gate(1, FAILED_OUTCOME), tail]).failed_call_count).toBe(1)
	})
})

describe('time_failures.build_failures — an outcome nobody could read', () => {
	it('reports a transcript with no readable outcome as unmeasured rather than as no failures', () => {
		const totals = time_failures.build_failures([
			outcome_span(1, UNKNOWN_OUTCOME, 'Read'),
			outcome_span(2, UNKNOWN_OUTCOME, 'Read'),
		])

		expect(totals.is_measured).toBe(false)
		expect(totals.unknown_call_count).toBe(2)
	})

	it('counts the unreadable calls beside the failures where some were readable', () => {
		const totals = time_failures.build_failures([
			outcome_span(1, UNKNOWN_OUTCOME, 'Read'),
			gate(2, FAILED_OUTCOME),
		])

		expect(totals.is_measured).toBe(true)
		expect(totals.unknown_call_count).toBe(1)
		expect(totals.failed_call_count).toBe(1)
	})

	it('reports an empty span list as unmeasured', () => {
		expect(time_failures.build_failures([])).toEqual(time_failures.NO_FAILURES)
	})
})

describe('time_failures.failure_lines', () => {
	it('prints the failure count and the re-run share of tool execution', () => {
		const totals = time_failures.build_failures(MIXED)
		const text = time_failures.failure_lines(totals, 5, 5 * MINUTE_MS).join('\n')

		expect(text).toContain(time_failures.HEADING)
		expect(text).toContain('of 5 call(s)')
		expect(text).toContain('20.0% of tool execution')
	})

	it('names how many calls came back with no outcome to read', () => {
		const totals = time_failures.build_failures([
			outcome_span(1, UNKNOWN_OUTCOME, 'Read'),
			gate(2, FAILED_OUTCOME),
		])

		expect(time_failures.failure_lines(totals, 2, MINUTE_MS).join('\n')).toContain(
			`1 ${time_failures.UNREADABLE_SUFFIX}`,
		)
	})

	// Zero here would read as a run that got everything right first time, which is the one answer a
	// transcript with no readable outcome cannot support.
	it('withholds both figures rather than printing zeroes where nothing was readable', () => {
		const text = time_failures.failure_lines(time_failures.NO_FAILURES, 0, 0).join('\n')

		expect(text).toContain(time_failures.FAILED_LABEL)
		expect(text).not.toContain('0 ')
		expect(text.match(/not measured/gu)).toHaveLength(2)
	})
})
