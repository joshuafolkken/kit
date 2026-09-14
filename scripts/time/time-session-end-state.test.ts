import type { Span } from '#scripts/time-runtime/time-spans'
import { describe, expect, it } from 'vitest'
import { time_session_end_state } from './time-session-end-state'
import { time_transcript_fixture } from './time-transcript-fixture'

const { span } = time_transcript_fixture

function failed(josh_command: string): Span {
	return { ...span('Bash', 2, 1), outcome: 'failed', josh_command }
}

function merged(): Span {
	return {
		...span('Bash', 3, 1),
		outcome: 'ok',
		josh_command: 'josh followup',
		followup_stages: [{ name: 'merge', duration_ms: 1000 }],
	}
}

describe('time_session_end_state.classify', () => {
	it('reads a merge from a successful followup that reached the merge stage', () => {
		expect(time_session_end_state.classify([span('Read', 1, 1), merged()]).state).toBe('merged')
	})

	it('reads a stop from a failed command, naming it', () => {
		const end = time_session_end_state.classify([span('Read', 1, 1), failed('josh gate')])

		expect(end).toEqual({ state: 'stopped', last_failed_command: 'josh gate' })
	})

	// A merge wins even when an earlier command failed and was then recovered.
	it('reads a merge even when an earlier command failed', () => {
		expect(time_session_end_state.classify([failed('josh gate'), merged()]).state).toBe('merged')
	})

	it('names the raw tool label when a failed span ran no josh command', () => {
		const end = time_session_end_state.classify([{ ...span('Bash', 2, 1), outcome: 'failed' }])

		expect(end.last_failed_command).toBe('Bash')
	})

	it('is not detected when nothing merged and nothing failed', () => {
		expect(time_session_end_state.classify([span('Read', 1, 1)]).state).toBe('not_detected')
	})
})
