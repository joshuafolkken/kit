import { describe, expect, it } from 'vitest'
import { transcript_record } from './transcript-record'

function line_of(content: unknown, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({ type: 'assistant', message: { id: 'msg_1', content }, ...extra })
}

const BASH_CALL = { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }

describe('transcript_record.parse — one JSONL line', () => {
	it('reads the line fields and the message', () => {
		const fields = { timestamp: '2026-10-21T00:00:00Z', gitBranch: '4182-lane' }
		const record = transcript_record.parse(line_of([BASH_CALL], fields))

		expect(record).toMatchObject({ type: 'assistant', ...fields, message: { id: 'msg_1' } })
	})

	it.each([
		['an empty line', ''],
		['a truncated object', '{"type":"assistant","mes'],
		['a message that is a string', JSON.stringify({ type: 'error', message: 'boom' })],
	])('reads %s as undefined', (_label, line) => {
		expect(transcript_record.parse(line)).toBeUndefined()
	})

	it('keeps a line whose block is of a shape no reader has seen', () => {
		const record = transcript_record.parse(line_of([{ type: 'image', source: { data: 'x' } }]))

		expect(transcript_record.blocks_of(record ?? {})).toEqual([{ type: 'image' }])
	})

	it('keeps a tool result whose body is neither a string nor a list of text blocks', () => {
		const result = { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ text: 1 }] }

		expect(transcript_record.parse(line_of([result]))).toBeDefined()
	})
})

describe('transcript_record.read — an already parsed value', () => {
	it('reads an object the way parse reads its text', () => {
		const value: unknown = JSON.parse(line_of([BASH_CALL]))

		expect(transcript_record.read(value)).toEqual(transcript_record.parse(line_of([BASH_CALL])))
	})

	it('reads a non-object as undefined', () => {
		expect(transcript_record.read([1, 2])).toBeUndefined()
	})
})

describe('transcript_record.blocks_of', () => {
	it('reads a message written as a bare string as no blocks', () => {
		const record = transcript_record.parse(line_of('a prompt'))

		expect(transcript_record.blocks_of(record ?? {})).toEqual([])
	})

	it('reads a line without a message as no blocks', () => {
		expect(transcript_record.blocks_of({ type: 'system' })).toEqual([])
	})
})

describe('transcript_record.tool_calls_of', () => {
	it('keeps the named tool_use blocks in order and drops every other block', () => {
		const read_call = { type: 'tool_use', name: 'Read', input: { file_path: '/a' } }
		const record = transcript_record.parse(
			line_of([{ type: 'text', text: 'hi' }, BASH_CALL, read_call]),
		)
		const names = transcript_record.tool_calls_of(record ?? {}).map((call) => call.name)

		expect(names).toEqual(['Bash', 'Read'])
	})

	it('drops a tool_use block that carries no name', () => {
		const record = transcript_record.parse(line_of([{ type: 'tool_use', input: {} }]))

		expect(transcript_record.tool_calls_of(record ?? {})).toEqual([])
	})
})
