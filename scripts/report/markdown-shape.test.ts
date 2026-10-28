import { describe, expect, it } from 'vitest'
import { markdown_shape } from './markdown-shape'

describe('markdown_shape.content_lines', () => {
	it('counts the non-blank lines only', () => {
		expect(markdown_shape.content_lines('a\n\n  \nb\n')).toEqual(['a', 'b'])
	})

	it('answers no lines for an empty text', () => {
		expect(markdown_shape.content_lines('')).toEqual([])
	})
})

describe('markdown_shape.fence_violation', () => {
	it('flags a text whose first non-blank line opens a fence, naming the subject', () => {
		expect(markdown_shape.fence_violation('\n\n```md\nx\n```', 'review')).toEqual([
			'✖ the review is wrapped in a code fence — write it as plain markdown',
		])
	})

	it('leaves a fence later in the text alone', () => {
		expect(markdown_shape.fence_violation('text\n```\ncode\n```', 'summary')).toEqual([])
	})

	it('answers no violation for a blank text', () => {
		expect(markdown_shape.fence_violation('  \n', 'summary')).toEqual([])
	})
})
