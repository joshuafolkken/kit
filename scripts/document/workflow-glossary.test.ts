import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'
import { section_reference_resolution } from './section-reference-fixture'

// The agent documents use their own vocabulary — lane, cut, hold, park — hundreds of times without
// defining it once. The glossary defines each term in a line or two and points at the single source
// that holds its body (joshuafolkken/kit#3080). What can rot is the pointer: a renamed heading leaves
// a definition naming a section that no longer exists, so every entry must resolve.

const GLOSSARY = 'prompts/collaboration-workflow/glossary.md'

const REQUIRED_TERMS = [
	'lane',
	'cut',
	'hold',
	'park',
	'point of use',
	'entry read',
	'oracle',
	'interrupt',
	'Tier',
]

const ENTRY_PATTERN = /^- \*\*([^*]+)\*\* — (.+)$/gmu

interface GlossaryEntry {
	term: string
	body: string
}

function glossary_entries(): Array<GlossaryEntry> {
	return [...read_document(GLOSSARY).matchAll(ENTRY_PATTERN)].map((match) => ({
		term: match[1] ?? '',
		body: match[2] ?? '',
	}))
}

const ENTRIES = glossary_entries()

describe('the workflow glossary', () => {
	it.each(REQUIRED_TERMS)('defines %j', (term) => {
		expect(ENTRIES.map((entry) => entry.term)).toContain(term)
	})

	it.each(ENTRIES.map((entry) => [entry.term, entry.body]))(
		'%s points at a single source',
		(_term, body) => {
			expect(document_scan.section_references(body).length).toBeGreaterThan(0)
		},
	)

	it.each(ENTRIES.map((entry) => [entry.term, entry.body]))(
		'%s points only at sections that exist',
		(_term, body) => {
			expect(section_reference_resolution.broken_section_references(body)).toStrictEqual([])
		},
	)

	// The resolution check is only worth keeping if it fails on the pointer it exists to catch.
	it('flags an entry whose pointer names a missing heading', () => {
		const body = 'x → `prompts/collaboration-workflow/residency.md` → "No Such Heading Here"'

		expect(section_reference_resolution.broken_section_references(body)).not.toStrictEqual([])
	})
})
