import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { last_prompt } from './last-prompt'

// joshuafolkken/kit#7781: a prompt a large read pushed off the tail is read further back. Kept apart
// from `last-prompt.test.ts`, which touches no file and runs in the pure pool.

const PROMPT = 'explain this log'
const TIMESTAMP = '2026-10-01T00:00:00.000Z'
const PROMPT_LINE = JSON.stringify({
	type: 'user',
	timestamp: TIMESTAMP,
	message: { role: 'user', content: PROMPT },
})
const TOOL_RESULT_LINE = JSON.stringify({
	type: 'user',
	timestamp: TIMESTAMP,
	message: {
		role: 'user',
		content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '#9' }],
	},
})
const WORK_DIRECTORY = temporary_directory('suite')('last-prompt-reach-')
const MISSING = path.join(WORK_DIRECTORY, 'missing.jsonl')

describe('last_prompt.prompt_reach', () => {
	const TRANSCRIPT = path.join(WORK_DIRECTORY, 'transcript.jsonl')

	writeFileSync(TRANSCRIPT, [PROMPT_LINE, TOOL_RESULT_LINE].join('\n'))

	it('keeps the tail when it carries the person’s prompt, though the transcript is readable', () => {
		expect(last_prompt.prompt_reach(PROMPT_LINE, TRANSCRIPT)).toBe(PROMPT_LINE)
	})

	it('reads further back when the tail carries no prompt', () => {
		const text = last_prompt.prompt_reach(TOOL_RESULT_LINE, TRANSCRIPT)

		expect(last_prompt.person_prompt(text)).toBe(PROMPT)
	})

	it('keeps the tail when the transcript is missing', () => {
		expect(last_prompt.prompt_reach(TOOL_RESULT_LINE, MISSING)).toBe(TOOL_RESULT_LINE)
	})
})

// joshuafolkken/kit#9093: a call's prompt is read before the call's line, however far the transcript
// has grown after it.
const CALL_ID = 'toolu_call'
const CALL_LINE = JSON.stringify({
	type: 'assistant',
	timestamp: TIMESTAMP,
	message: { content: [{ type: 'tool_use', id: CALL_ID, name: 'Agent', input: {} }] },
})
// More than `PROMPT_REACH_BYTES` after the call.
const LATER_LINES = 5
const LATER_LINE_BYTES = 1_048_576
const LATER_LINE = JSON.stringify({
	type: 'assistant',
	timestamp: TIMESTAMP,
	message: { content: [{ type: 'text', text: 'x'.repeat(LATER_LINE_BYTES) }] },
})

describe('last_prompt.call_prompt_at — a call beyond the tail', () => {
	const GROWN = path.join(WORK_DIRECTORY, 'grown.jsonl')

	writeFileSync(
		GROWN,
		[PROMPT_LINE, CALL_LINE, ...Array.from({ length: LATER_LINES }, () => LATER_LINE)].join('\n'),
	)

	it('reads the prompt before the call’s line', () => {
		expect(last_prompt.call_prompt_at(GROWN, CALL_ID)).toBe(PROMPT)
	})

	it('refuses a call that is nowhere in the transcript', () => {
		expect(last_prompt.call_prompt_at(GROWN, 'toolu_absent')).toBeUndefined()
	})
})
