import type { Span } from '#scripts/time-runtime/time-spans'
import { describe, expect, it } from 'vitest'
import type { RequestTokens } from './time-request-costs'
import { time_session_signals } from './time-session-signals'
import { time_transcript_fixture } from './time-transcript-fixture'

const { span } = time_transcript_fixture

const MINUTE_MS = 60_000
const CONTEXT_LOW = 100
const CONTEXT_HIGH = 300
const MEDIAN_CONTEXT = 200
const SAMPLE_CONTEXT = 5000
const SMALL_OUTPUT = 10
const LARGE_OUTPUT = 100_000

function edit(ended_minute: number): Span {
	return { ...span('Edit', ended_minute, 1), is_writing: true, marker: 'edit' }
}

function check(ended_minute: number): Span {
	return {
		...span('Bash', ended_minute, 1),
		josh_command: 'josh lint:related',
		check_key: 'josh lint:related a.ts',
	}
}

// A model span long enough to be a stall candidate, followed by a tool span so the model wait closes
// into a `ModelGap` (a tool span after a model span opens a round trip).
function model(ended_minute: number, duration_minutes: number): Span {
	return { ...span('model', ended_minute, duration_minutes), category: 'model' }
}

function request(at_minute: number, billed_input: number, output_tokens: number): RequestTokens {
	return { at_ms: at_minute * MINUTE_MS, billed_input, output_tokens }
}

describe('time_session_signals.build — check loop', () => {
	it('counts edits followed by a check and the median context at those checks', () => {
		const spans = [edit(1), check(2), edit(5), check(6)]
		const requests = [request(2, CONTEXT_LOW, SMALL_OUTPUT), request(6, CONTEXT_HIGH, SMALL_OUTPUT)]

		const { check_loop } = time_session_signals.build(spans, requests)

		expect(check_loop?.count).toBe(2)
		expect(check_loop?.median_context_tokens).toBe(MEDIAN_CONTEXT)
	})

	it('withholds the check loop when no check followed an edit', () => {
		const { check_loop } = time_session_signals.build([edit(1), edit(2)], [])

		expect(check_loop).toBeUndefined()
	})
})

describe('time_session_signals.build — stalls', () => {
	// Eleven minutes of model wait is over the ten-minute floor; ten output tokens is far under the
	// per-second bar, so the wait is a stall candidate.
	const LONG_WAIT = [model(11, 11), span('Bash', 12, 1)]

	it('lists a long wait that returned few output tokens', () => {
		const requests = [request(11, SAMPLE_CONTEXT, SMALL_OUTPUT)]

		const { stalls } = time_session_signals.build(LONG_WAIT, requests)

		expect(stalls).toHaveLength(1)
		expect(stalls[0]?.wait_ms).toBe(11 * MINUTE_MS)
		expect(stalls[0]?.output_tokens).toBe(SMALL_OUTPUT)
	})

	it('ignores a long wait that returned a large answer', () => {
		const requests = [request(11, SAMPLE_CONTEXT, LARGE_OUTPUT)]

		const { stalls } = time_session_signals.build(LONG_WAIT, requests)

		expect(stalls).toHaveLength(0)
	})

	it('ignores a wait under the floor', () => {
		const spans = [model(6, 5), span('Bash', 7, 1)]
		const requests = [request(6, SAMPLE_CONTEXT, SMALL_OUTPUT)]

		const { stalls } = time_session_signals.build(spans, requests)

		expect(stalls).toHaveLength(0)
	})
})
