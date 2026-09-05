import { describe, expect, it } from 'vitest'
import { time_spans } from './time-spans'

// Which turn a span belongs to (joshuafolkken/kit#1406).
//
// It sits beside `time-spans.test.ts` rather than inside it because that file reached its length
// limit — the seam `time-phases-regions.test.ts` was already cut along, and for the same reason.
// The line builders are its own: they write a `message.id`, which the ones next door deliberately do
// not, and every case here turns on that field.

const ASSISTANT = 'assistant'
const USER = 'user'
const MESSAGE_ID = 'msg-1'
const CALL_ID = 'tool-1'

function at(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
}

function prompt(minute: number): string {
	return JSON.stringify({ type: USER, timestamp: at(minute), message: { content: 'do the thing' } })
}

// Claude Code writes one line per content block and repeats the assistant message's id on each, so
// the id is the only thing that says which lines were one turn.
function text_line(minute: number, message_id: string): string {
	return JSON.stringify({
		type: ASSISTANT,
		timestamp: at(minute),
		message: { id: message_id, content: [{ type: 'text', text: 'hello' }] },
	})
}

function call_line(minute: number, message_id: string): string {
	return JSON.stringify({
		type: ASSISTANT,
		timestamp: at(minute),
		message: {
			id: message_id,
			content: [{ type: 'tool_use', name: 'Read', id: CALL_ID, input: {} }],
		},
	})
}

function result_line(minute: number): string {
	return JSON.stringify({
		type: USER,
		timestamp: at(minute),
		message: { content: [{ type: 'tool_result', tool_use_id: CALL_ID, content: 'done' }] },
	})
}

const TAGGED_TURN = [
	prompt(0),
	text_line(1, MESSAGE_ID),
	call_line(2, MESSAGE_ID),
	result_line(3),
].join('\n')

describe('time_spans.parse_timeline — the turn a span belongs to', () => {
	it('carries the message id of the assistant line a model span closes at', () => {
		const { spans } = time_spans.parse_timeline(TAGGED_TURN)
		const model = spans.filter((one) => one.category === time_spans.MODEL_CATEGORY)

		expect(model.map((one) => one.message_id)).toEqual([MESSAGE_ID, MESSAGE_ID])
	})

	// **Read off the call, not off the result.** A `tool_result` line carries no message id at all, so
	// a span taking it from the event that closes it could never name the turn that issued the call.
	it('carries the message id of the line that issued the call on a tool span', () => {
		const { spans } = time_spans.parse_timeline(TAGGED_TURN)
		const tool = spans.filter((one) => one.category === time_spans.TOOL_CATEGORY)

		expect(tool.map((one) => one.message_id)).toEqual([MESSAGE_ID])
	})

	// A person typing belongs to no assistant message, and the empty string is what says so.
	it('leaves a human span with no message id', () => {
		const { spans } = time_spans.parse_timeline([text_line(0, MESSAGE_ID), prompt(5)].join('\n'))

		expect(spans[0]?.message_id).toBe(time_spans.NO_MESSAGE_ID)
	})
})
