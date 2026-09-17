import { describe, expect, it } from 'vitest'
import { cost_blocks, type ContentBlock } from './cost-blocks'

const COMMAND = 'git status --short'
const DESCRIPTION = 'Show working tree status'
const TOOL_USE = 'tool_use'
const TOOL_RESULT = 'tool_result'
const BARE_PROMPT = 'prompt plus whatever a hook injected'
const MALFORMED = '{ not json'

function assistant_line(blocks: ReadonlyArray<unknown>): string {
	return JSON.stringify({ type: 'assistant', message: { content: blocks } })
}

function user_line(content: unknown): string {
	return JSON.stringify({ type: 'user', message: { content } })
}

function first(line: string): ContentBlock | undefined {
	return cost_blocks.parse_line(line)[0]
}

describe('parse_line — the assistant side', () => {
	it('reads a text block', () => {
		expect(first(assistant_line([{ type: 'text', text: 'hello' }]))?.text).toBe('hello')
	})

	// Claude Code writes the block with its signature and an empty `thinking`, so the text is
	// genuinely absent here; the count comes from the API's own `thinking_tokens` instead.
	it('reads a thinking block as empty rather than dropping it', () => {
		const block = first(assistant_line([{ type: 'thinking', thinking: '', signature: 'sig' }]))

		expect(block).toStrictEqual({ type: 'thinking', tool_name: '', command: '', text: '' })
	})

	it('splits a Bash command body out of the rest of its input', () => {
		const block = first(
			assistant_line([
				{ type: TOOL_USE, name: 'Bash', input: { command: COMMAND, description: DESCRIPTION } },
			]),
		)

		expect(block?.command).toBe(COMMAND)
		expect(block?.text).toContain(DESCRIPTION)
		expect(block?.text).not.toContain(COMMAND)
	})

	// Only Bash is split. Another tool's `command` key is not the quantity being tracked, and folding
	// it in would report a number nobody measured.
	it('keeps the whole input of another tool together', () => {
		const block = first(
			assistant_line([{ type: TOOL_USE, name: 'Read', input: { command: COMMAND } }]),
		)

		expect(block?.command).toBe('')
		expect(block?.text).toContain(COMMAND)
	})
})

describe('parse_line — the user side', () => {
	it('reads a string tool_result', () => {
		expect(first(user_line([{ type: TOOL_RESULT, content: 'output' }]))?.text).toBe('output')
	})

	// An image item carries no text, and inventing a size for it would put a made-up number in a
	// table whose purpose is to be compared with another run's.
	it('reads only the textual items of a block-list tool_result', () => {
		const block = first(
			user_line([{ type: TOOL_RESULT, content: [{ type: 'text', text: 'a' }, { type: 'image' }] }]),
		)

		expect(block?.text).toBe('a')
	})

	it('reads a bare string user turn as text', () => {
		const block = first(user_line(BARE_PROMPT))

		expect(block?.type).toBe(cost_blocks.TEXT_TYPE)
		expect(block?.text).toBe(BARE_PROMPT)
	})

	it.each(['', ' '.repeat(3), MALFORMED, JSON.stringify({ type: 'system' })])(
		'contributes nothing for %j',
		(line) => {
			expect(cost_blocks.parse_line(line)).toStrictEqual([])
		},
	)
})

describe('parse_line — a block it has never seen', () => {
	// One unexpected block used to fail the array it sat in, taking every other block on the line
	// with it — a whole assistant turn dropped from the table because one tool wrote a new shape.
	it('costs one block rather than the whole line', () => {
		const blocks = cost_blocks.parse_line(
			assistant_line([{ shape: 'nobody has seen this' }, { type: 'text', text: 'kept' }]),
		)

		expect(blocks).toHaveLength(2)
		expect(blocks[1]?.text).toBe('kept')
	})
})

describe('parse_content — a whole transcript', () => {
	it('reads every line', () => {
		const content = [
			assistant_line([{ type: 'text', text: 'one' }]),
			MALFORMED,
			user_line([{ type: 'tool_result', content: 'two' }]),
		].join('\n')

		expect(cost_blocks.parse_content(content).map((block) => block.text)).toStrictEqual([
			'one',
			'two',
		])
	})
})
