import { describe, expect, it } from 'vitest'
import {
	all_documents,
	CONTRIBUTING_DOC,
	has_japanese_prose,
	linked_paths,
	read_document,
} from './ai-document-fixture'

// joshuafolkken/kit#7241: an outside contributor lands on `CONTRIBUTING.md` from the README. Its
// relative links are resolved by `link-resolution.test.ts`, which reads every `all_documents()` entry.
const README = 'README.md'
// joshuafolkken/kit#7282: epic #7212 keeps its items under consideration and declines none, so the
// section's example must not call them declined.
const REVISIT_HEADING = '## Decisions not to act, and when they are revisited'
const EPIC_7212_LINK = '[#7212](https://github.com/joshuafolkken/kit/issues/7212)'

function revisit_section(): string {
	const text = read_document(CONTRIBUTING_DOC)
	const start = text.indexOf(REVISIT_HEADING)
	const end = text.indexOf('\n## ', start + REVISIT_HEADING.length)

	return text.slice(start, end).replaceAll(/\s+/gu, ' ')
}

describe('the contributing guide', () => {
	it('is where the README sends a contributor', () => {
		expect(linked_paths(README)).toContain(CONTRIBUTING_DOC)
	})

	it('is read by the corpus-wide document scans', () => {
		expect(all_documents()).toContain(CONTRIBUTING_DOC)
	})

	it('carries no Japanese prose', () => {
		expect(has_japanese_prose(read_document(CONTRIBUTING_DOC))).toBe(false)
	})

	it('covers reports kept under consideration as well as declined ones', () => {
		const section = revisit_section()

		expect(section).toContain(REVISIT_HEADING)
		expect(section).toContain('declined or kept under consideration')
		expect(section).toContain('comment on the same Issue rather than opening a new one')
	})

	it('cites the items under consideration on epic #7212, not declined items', () => {
		const section = revisit_section()

		expect(section).toContain(`items under consideration listed on ${EPIC_7212_LINK}`)
		expect(section).not.toContain('declined items')
	})
})
