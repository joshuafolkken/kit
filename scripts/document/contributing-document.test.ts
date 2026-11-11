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
})
