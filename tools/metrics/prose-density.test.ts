import { describe, expect, it } from 'vitest'
import { prose_density } from './prose-density'

const { LONG_PARAGRAPH_CHARACTERS } = prose_density
const LONG_LINE = 'a'.repeat(LONG_PARAGRAPH_CHARACTERS + 1)
const EXACT_LINE = 'a'.repeat(LONG_PARAGRAPH_CHARACTERS)
// Two wrapped lines, each short, joined past the limit — the same paragraph a single line would be.
const HALF_LINE = 'a'.repeat(LONG_PARAGRAPH_CHARACTERS / 2)

function long_paragraphs(text: string): number {
	return prose_density.measure(text).long_paragraphs
}

function excess_bold(text: string): number {
	return prose_density.measure(text).excess_bold
}

describe('prose_density.measure — long paragraphs', () => {
	it('counts a paragraph past the limit and not one at it', () => {
		expect(long_paragraphs(`${LONG_LINE}\n`)).toBe(1)
		expect(long_paragraphs(`${EXACT_LINE}\n`)).toBe(0)
	})

	it('reads wrapped lines as one paragraph, so a column-wrapped document is measured the same', () => {
		expect(long_paragraphs(`${HALF_LINE}\n${HALF_LINE}\n`)).toBe(1)
	})

	it('ends a paragraph at a blank line, a heading or a table row', () => {
		expect(long_paragraphs(`${HALF_LINE}\n\n${HALF_LINE}\n`)).toBe(0)
		expect(long_paragraphs(`${HALF_LINE}\n## Next\n${HALF_LINE}\n`)).toBe(0)
		expect(long_paragraphs(`${HALF_LINE}\n| a |\n${HALF_LINE}\n`)).toBe(0)
	})

	it('starts a new paragraph at each list item', () => {
		expect(long_paragraphs(`- ${HALF_LINE}\n- ${HALF_LINE}\n`)).toBe(0)
		expect(long_paragraphs(`1. ${HALF_LINE}\n  ${HALF_LINE}\n`)).toBe(1)
	})

	it('does not count fenced code as prose', () => {
		expect(long_paragraphs(`\`\`\`text\n${LONG_LINE}\n\`\`\`\n`)).toBe(0)
		expect(long_paragraphs(`~~~\n${LONG_LINE}\n~~~\n`)).toBe(0)
	})

	it('counts characters, not bytes', () => {
		expect(long_paragraphs(`${'品'.repeat(LONG_PARAGRAPH_CHARACTERS)}\n`)).toBe(0)
	})
})

describe('prose_density.measure — bold per section', () => {
	it('allows one bold span per section and counts every one past it', () => {
		expect(excess_bold('## A\n**one**\n')).toBe(0)
		expect(excess_bold('## A\n**one** and **two**\n**three**\n')).toBe(2)
	})

	it('holds each section to its own allowance', () => {
		expect(excess_bold('**lead**\n## A\n**one**\n## B\n**two**\n')).toBe(0)
		expect(excess_bold('## A\n**one**\n**two**\n## B\n**three**\n')).toBe(1)
	})

	it('does not count bold inside fenced code', () => {
		expect(excess_bold('## A\n**one**\n```\n**two** **three**\n```\n')).toBe(0)
	})

	it('counts a heading-shaped line inside a fence as no section', () => {
		expect(excess_bold('## A\n**one**\n```\n# comment\n```\n**two**\n')).toBe(1)
	})
})

describe('prose_density.totals', () => {
	it('sums both totals across documents', () => {
		const dense = `${LONG_LINE}\n\n**a** **b**\n`

		expect(prose_density.totals([dense, dense, ''])).toStrictEqual({
			long_paragraphs: 2,
			excess_bold: 2,
		})
	})

	it('answers zero for no documents', () => {
		expect(prose_density.totals([])).toStrictEqual({ long_paragraphs: 0, excess_bold: 0 })
	})
})
