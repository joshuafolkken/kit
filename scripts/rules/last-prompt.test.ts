import { describe, expect, it } from 'vitest'
import { last_prompt } from './last-prompt'

const TIMESTAMP = '2026-10-01T00:00:00.000Z'

// A `user` line as Claude Code writes it; `fields` adds the harness markers (`isMeta`, `origin`).
function prompt_line(content: unknown, fields: Record<string, unknown> = {}): string {
	const line = { type: 'user', timestamp: TIMESTAMP, ...fields, message: { role: 'user', content } }

	return JSON.stringify(line)
}

const TOOL_RESULT_LINE = prompt_line([
	{ type: 'tool_result', tool_use_id: 'toolu_1', content: '#9' },
])
const ASSISTANT_LINE = JSON.stringify({ type: 'assistant', message: { content: 'see #3' } })
const PASTED_PROMPT = 'explain this log: closed #7'
const NOTIFICATION = 'task-notification'

describe('last_prompt.turn_prompt — what the harness wrote is not the prompt', () => {
	it('reads a prompt written as text blocks', () => {
		const tail = prompt_line([{ type: 'text', text: PASTED_PROMPT }])

		expect(last_prompt.turn_prompt(tail)).toBe(PASTED_PROMPT)
	})

	it('reads nothing for a turn a meta line such as an expanded skill body opened', () => {
		const tail = [
			prompt_line(PASTED_PROMPT),
			prompt_line([{ type: 'text', text: 'skill #5' }], { isMeta: true }),
		]

		expect(last_prompt.turn_prompt(tail.join('\n'))).toBe('')
	})

	it('reads a prompt whose origin is human', () => {
		const tail = prompt_line(PASTED_PROMPT, { origin: { kind: 'human' } })

		expect(last_prompt.turn_prompt(tail)).toBe(PASTED_PROMPT)
	})

	it('reads nothing for a tail with no prompt on it', () => {
		expect(last_prompt.turn_prompt([ASSISTANT_LINE, 'not json'].join('\n'))).toBe('')
	})
})

// joshuafolkken/kit#3961: the prompt that opened this turn, and when the current pause began.
describe('last_prompt.turn_prompt and pause_start', () => {
	const LATER = '2026-10-01T00:05:00.000Z'

	it('reads the prompt of a turn a person opened', () => {
		const tail = [prompt_line(PASTED_PROMPT), ASSISTANT_LINE, TOOL_RESULT_LINE]

		expect(last_prompt.turn_prompt(tail.join('\n'))).toBe(PASTED_PROMPT)
	})

	it('reads nothing for a turn a task notification opened', () => {
		const tail = [
			prompt_line(PASTED_PROMPT),
			prompt_line('done', { origin: { kind: NOTIFICATION } }),
		]

		expect(last_prompt.turn_prompt(tail.join('\n'))).toBe('')
	})

	it('starts the pause at the last person prompt, skipping what the harness wrote', () => {
		const tail = [
			prompt_line(PASTED_PROMPT),
			prompt_line('done', { timestamp: LATER, origin: { kind: NOTIFICATION } }),
		]

		expect(last_prompt.pause_start(tail.join('\n'))).toBe(TIMESTAMP)
	})

	it('starts the pause at the tail’s first dated line when no prompt is on it', () => {
		const notice = prompt_line('done', { timestamp: LATER, origin: { kind: NOTIFICATION } })

		expect(last_prompt.pause_start([ASSISTANT_LINE, notice].join('\n'))).toBe(LATER)
	})

	it('starts nothing on a tail with no dated line', () => {
		expect(last_prompt.pause_start(ASSISTANT_LINE)).toBeUndefined()
	})
})
