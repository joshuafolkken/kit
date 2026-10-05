import { describe, expect, it } from 'vitest'
import { time_transcript_line } from './time-transcript-line'

describe('time_transcript_line.guard_from_refusal', () => {
	it('reads the guard off a bare refusal body', () => {
		expect(time_transcript_line.guard_from_refusal('⛔ batching: reissue this')).toBe('batching')
	})

	it('reads the guard behind the label the harness writes in front of a PreToolUse deny', () => {
		const body = 'PreToolUse:Edit hook error: ⛔ implementation-phase cut: take the cut'

		expect(time_transcript_line.guard_from_refusal(body)).toBe('implementation-phase cut')
	})

	it('reads no guard from a hook error that is not a refusal', () => {
		expect(time_transcript_line.guard_from_refusal('PreToolUse:Bash hook error: boom')).toBe('')
	})

	it('reads no guard from a PostToolUse hook error, which fires after the call ran', () => {
		const body = 'PostToolUse:Edit hook error: ⛔ implementation-phase cut: take the cut'

		expect(time_transcript_line.guard_from_refusal(body)).toBe('')
	})
})
