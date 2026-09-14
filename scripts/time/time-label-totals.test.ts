import { time_spans } from '#scripts/time-runtime/time-spans'
import { describe, expect, it } from 'vitest'
import { time_label_totals } from './time-label-totals'
import { time_span_fixture } from './time-span-fixture'

const { span, MINUTE_MS } = time_span_fixture
const { TOOL_CATEGORY } = time_spans
const LONG_MINUTES = 3
const SHORT_MINUTES = 2

describe('time_label_totals.totals_by', () => {
	it('sums calls and durations per label, longest first', () => {
		const spans = [
			span(TOOL_CATEGORY, 1, 'Read'),
			span(TOOL_CATEGORY, LONG_MINUTES, 'Edit'),
			span(TOOL_CATEGORY, 1, 'Read'),
		]

		expect(time_label_totals.totals_by(spans, (item) => item.label)).toStrictEqual([
			{ label: 'Edit', duration_ms: LONG_MINUTES * MINUTE_MS, call_count: 1 },
			{ label: 'Read', duration_ms: SHORT_MINUTES * MINUTE_MS, call_count: 2 },
		])
	})

	it('skips spans whose key is empty', () => {
		const spans = [span(TOOL_CATEGORY, 1, ''), span(TOOL_CATEGORY, 1, 'Bash')]

		expect(time_label_totals.totals_by(spans, (item) => item.label)).toStrictEqual([
			{ label: 'Bash', duration_ms: MINUTE_MS, call_count: 1 },
		])
	})

	it('counts a continuation neither as a call nor as duration', () => {
		const head = span(TOOL_CATEGORY, 1, 'Agent')
		const tail = { ...span(TOOL_CATEGORY, SHORT_MINUTES, 'Agent'), is_continuation: true }

		expect(time_label_totals.totals_by([head, tail], (item) => item.label)).toStrictEqual([
			{ label: 'Agent', duration_ms: MINUTE_MS, call_count: 1 },
		])
	})

	it('reports the call its own duration rather than its share of the wall clock', () => {
		const shared = { ...span(TOOL_CATEGORY, 1, 'Bash'), own_duration_ms: LONG_MINUTES * MINUTE_MS }

		expect(time_label_totals.totals_by([shared], (item) => item.label)).toStrictEqual([
			{ label: 'Bash', duration_ms: LONG_MINUTES * MINUTE_MS, call_count: 1 },
		])
	})
})
