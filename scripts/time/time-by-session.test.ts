import { describe, expect, it } from 'vitest'
import { time_by_session } from './time-by-session'
import type { SessionTimeline } from './time-corpus'
import type { Span } from './time-spans'
import { time_transcript_fixture } from './time-transcript-fixture'

const { span } = time_transcript_fixture

function model(ended_minute: number): Span {
	return { ...span('model', ended_minute, 1), category: 'model' }
}

function edit(ended_minute: number): Span {
	return { ...span('Edit', ended_minute, 1), is_writing: true, marker: 'edit' }
}

function merged(ended_minute: number): Span {
	return {
		...span('Bash', ended_minute, 1),
		outcome: 'ok',
		josh_command: 'josh followup',
		followup_stages: [{ name: 'merge', duration_ms: 1000 }],
	}
}

function failed_gate(ended_minute: number): Span {
	return { ...span('Bash', ended_minute, 1), outcome: 'failed', josh_command: 'josh gate' }
}

// A run stopped in `session-a` on a red gate and resumed in `session-b`, which reached its first edit at
// minute 12 and merged at 13. The timelines are handed in newest-first, as the corpus walk yields them.
const SESSION_A: SessionTimeline = {
	session_id: 'session-a',
	spans: [model(1), span('Read', 3, 2), failed_gate(4)],
}
const SESSION_B: SessionTimeline = {
	session_id: 'session-b',
	spans: [model(11), edit(12), merged(13)],
}

describe('time_by_session.build', () => {
	it('orders oldest first and marks the resume', () => {
		const rows = time_by_session.build([SESSION_B, SESSION_A])

		expect(rows.map((one) => one.session_id)).toEqual(['session-a', 'session-b'])
		expect(rows.map((one) => one.is_resumed)).toEqual([false, true])
	})

	it('reads each session end state', () => {
		const rows = time_by_session.build([SESSION_B, SESSION_A])

		expect(rows[0]?.end_state.state).toBe('stopped')
		expect(rows[1]?.end_state.state).toBe('merged')
	})

	it('sums the wall clock by category', () => {
		const [first] = time_by_session.build([SESSION_A])

		if (first === undefined) throw new Error('expected a session')

		expect(first.model_ms).toBeGreaterThan(0)
		expect(first.tool_ms).toBeGreaterThan(0)
		expect(first.elapsed_ms).toBe(first.model_ms + first.tool_ms)
	})

	// The resume session's first forward progress is its edit at minute 12, one minute after it opened.
	it('reports the resume time to first progress', () => {
		const rows = time_by_session.build([SESSION_B, SESSION_A])

		expect(rows[1]?.to_first_progress_ms).toBeGreaterThan(0)
		expect(rows[0]?.to_first_progress_ms).toBeUndefined()
	})
})
