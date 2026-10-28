import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { concise_reply } from './concise-reply'

const OVER = 'あ'.repeat(concise_reply.PROSE_LIMIT + 1)
const AT_LIMIT = 'あ'.repeat(concise_reply.PROSE_LIMIT)
const SECTION_CITATION = '"concise-reply"'
const SECTION_HEADING = '## concise-reply'
const KEEP_DECISION = 'Keep its `Recommended:`'

describe('concise_reply.is_over', () => {
	it('is true for narrative over the limit', () => {
		expect(concise_reply.is_over(OVER, '')).toBe(true)
	})

	it('is false for narrative at the limit', () => {
		expect(concise_reply.is_over(AT_LIMIT, '')).toBe(false)
	})

	it('counts no code block, table or list', () => {
		const structured = [
			'結論です。',
			'```',
			OVER,
			'```',
			`| ${OVER} |`,
			`- ${OVER}`,
			`1. ${OVER}`,
		].join('\n')

		expect(concise_reply.is_over(structured, '')).toBe(false)
	})

	it('is false for a fixed output returned in a code block alone', () => {
		expect(concise_reply.is_over(['```', OVER, '```'].join('\n'), '')).toBe(false)
	})

	it.each(concise_reply.EXEMPT_WORDS)('exempts a prompt that asks %s', (word) => {
		expect(concise_reply.is_over(OVER, `もっと${word}説明して`)).toBe(false)
	})

	it('refuses nothing when the prompt could not be read', () => {
		expect(concise_reply.is_over(OVER, undefined)).toBe(false)
	})

	it('counts no list written with ・ or •', () => {
		expect(concise_reply.is_over([`・${OVER}`, `• ${OVER}`].join('\n'), '')).toBe(false)
	})

	it('counts letters and digits, not punctuation or whitespace', () => {
		expect(concise_reply.prose_length('a b, 1。 **c**')).toBe(4)
	})
})

describe('concise_reply.build_reason', () => {
	it('opens with the constant rule-value credits, and names the count and the section', () => {
		const reason = concise_reply.build_reason(OVER)

		expect(reason.startsWith(concise_reply.REASON_OPENING)).toBe(true)
		expect(reason).toContain(`${String(concise_reply.PROSE_LIMIT + 1)} of`)
		expect(reason).toContain(SECTION_CITATION)
	})

	it('asks a reply carrying a decision to keep its decision lines', () => {
		const decided = `${OVER}\nRecommended: ship it`

		expect(concise_reply.build_reason(decided)).toContain(KEEP_DECISION)
		expect(concise_reply.build_reason(OVER)).not.toContain(KEEP_DECISION)
	})

	it('carries the section body from principles.md', () => {
		expect(concise_reply.build_reason(OVER)).toContain(SECTION_HEADING)
	})

	it('still names the section when principles.md cannot be read', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'concise-reply-'))

		try {
			const reason = concise_reply.build_reason(OVER, root)

			expect(reason).toContain(SECTION_CITATION)
			expect(reason).not.toContain(SECTION_HEADING)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
