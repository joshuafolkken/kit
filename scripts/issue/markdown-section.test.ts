import { describe, expect, it } from 'vitest'
import { markdown_section } from './markdown-section'

const HEADING = '## Target'
const FENCE = '```'
const AFTER_FENCE = 'after the fence'
const FENCED_HEADING_BODY = [HEADING, '', '```md', '## Example', FENCE, '', AFTER_FENCE].join('\n')

describe('markdown_section.section_lines', () => {
	it('returns the lines under the heading up to the next heading', () => {
		const body = ['## Before', 'x', HEADING, 'inside', '## After', 'outside'].join('\n')

		expect(markdown_section.section_lines(body, HEADING)).toEqual(['inside'])
	})

	it('runs to the end when no heading follows', () => {
		expect(markdown_section.section_lines(`${HEADING}\nlast`, HEADING)).toEqual(['last'])
	})

	it('returns nothing when the heading is absent', () => {
		expect(markdown_section.section_lines('## Other\ntext', HEADING)).toEqual([])
	})

	it('does not stop at a heading-shaped line inside a code fence', () => {
		expect(markdown_section.section_lines(FENCED_HEADING_BODY, HEADING)).toContain(AFTER_FENCE)
	})

	it('does not open the section at a fenced copy of the heading', () => {
		const body = [FENCE, HEADING, 'fenced', FENCE, HEADING, 'real'].join('\n')

		expect(markdown_section.section_lines(body, HEADING)).toEqual(['real'])
	})
})

describe('markdown_section.section_lines_matching', () => {
	it('opens the section at the first line the predicate accepts', () => {
		const body = ['## One', 'a', '## Two', 'b'].join('\n')
		const lines = markdown_section.section_lines_matching(body, (line) => line.trim() === '## Two')

		expect(lines).toEqual(['b'])
	})
})

describe('markdown_section.has_line', () => {
	it('finds an exact unfenced line', () => {
		expect(markdown_section.has_line(`text\n  ${HEADING}  `, HEADING)).toBe(true)
	})

	it('ignores a line inside a code fence', () => {
		expect(markdown_section.has_line([FENCE, HEADING, FENCE].join('\n'), HEADING)).toBe(false)
	})
})

describe('markdown_section.unfenced_lines', () => {
	it('blanks the fenced lines and keeps the rest in place', () => {
		const lines = markdown_section.unfenced_lines(['a', '~~~', 'b', '~~~', 'c'].join('\n'))

		expect(lines).toEqual(['a', '', '', '', 'c'])
	})
})
