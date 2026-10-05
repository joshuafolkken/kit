import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { time_transcript_line } from './time-transcript-line'

const { BRANCH } = time_transcript_fixture

function token_lines_of(line: string): ReadonlyArray<string> | undefined {
	return time_transcript_line.parse_line(line)?.blocks[0]?.token_lines
}

describe('time_transcript_line token lines', () => {
	it('keeps the bare verdict token a result printed and drops the prose around it', () => {
		const line = time_transcript_fixture.result_line(1, BRANCH, 'a', 'Relaunched.\n  cut  \n')

		expect(token_lines_of(line)).toEqual(['cut'])
	})

	it('keeps no token from a result the harness wrote back as a failure', () => {
		const line = time_transcript_fixture.error_result_line(1, BRANCH, 'a', 'busy')

		expect(token_lines_of(line)).toEqual([])
	})

	it('keeps at most the bounded number of token lines', () => {
		const body = Array.from({ length: 20 }, () => 'cut').join('\n')
		const line = time_transcript_fixture.result_line(1, BRANCH, 'a', body)

		expect(token_lines_of(line)).toHaveLength(time_transcript_line.TOKEN_LINE_LIMIT)
	})
})

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
