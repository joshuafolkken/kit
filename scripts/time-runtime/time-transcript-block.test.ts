import { describe, expect, it } from 'vitest'
import { time_transcript_block } from './time-transcript-block'

describe('time_transcript_block.to_blocks', () => {
	it('keeps the length of a result body, never the body', () => {
		const [block] = time_transcript_block.to_blocks([
			{ type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(42) },
		])

		expect(block?.result_chars).toBe(42)
		expect(block?.result_id).toBe('a')
	})

	it('counts a result written as a list of text blocks', () => {
		const content = [
			{ type: 'text', text: 'abc' },
			{ type: 'text', text: 'de' },
		]
		const [block] = time_transcript_block.to_blocks([{ type: 'tool_result', content }])

		expect(block?.result_chars).toBeGreaterThanOrEqual(5)
	})

	it('reads a call with no body as zero characters', () => {
		const [block] = time_transcript_block.to_blocks([{ type: 'tool_use', id: 'a', name: 'Read' }])

		expect(block?.result_chars).toBe(0)
	})

	it('reads a prompt written as a bare string as no blocks', () => {
		expect(time_transcript_block.to_blocks('hello')).toEqual([])
	})
})
