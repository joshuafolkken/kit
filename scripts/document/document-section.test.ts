import { describe, expect, it } from 'vitest'
import { document_section } from './document-section'

// joshuafolkken/kit#1776. The three behaviors a whole-file read does not have, and each of them is
// a way this reader could hand back the wrong text silently: a `#` inside a fence ending a section
// early, a prefix matching two headings, and a renamed target answering with nothing.

const TOP = 'Top'
const SECOND = 'Second'
const HAND_OFF = 'The hand-off'
const HAND_OFF_HEADING = `${HAND_OFF} — one session`
const LANES = 'Lanes'
const TITLE = 'Document title'

const SHELL_COMMENT = '# this is a shell comment, not a heading'
const AFTER_FENCE = 'still the top section'

const FENCED = [
	`# ${TITLE}`,
	'',
	`## ${TOP}`,
	'body one',
	'',
	'```bash',
	SHELL_COMMENT,
	'```',
	'',
	AFTER_FENCE,
	'',
	`## ${SECOND}`,
	'body two',
].join('\n')

const NESTED = [`## ${HAND_OFF_HEADING}`, 'a', '', '### Inner', 'b', '', '## Next', 'c'].join('\n')

const AMBIGUOUS = [`## ${LANES} are one thing`, 'a', '', `## ${LANES} are another`, 'b'].join('\n')

describe('document_section.section — what it returns', () => {
	it('keeps a fenced `#` line inside the section it sits in', () => {
		const found = document_section.section(FENCED, TOP)

		expect(found?.text).toContain(AFTER_FENCE)
		expect(found?.text).not.toContain('body two')
	})

	it('carries the subsections of the heading it was given', () => {
		const found = document_section.section(NESTED, HAND_OFF)

		expect(found?.text).toContain('### Inner')
		expect(found?.text).not.toContain('## Next')
	})

	it('resolves a reference that cites the heading without its gloss', () => {
		expect(document_section.section(NESTED, HAND_OFF)?.title).toBe(HAND_OFF_HEADING)
	})

	it('runs the last section to the end of the document', () => {
		expect(document_section.section(FENCED, SECOND)?.text).toContain('body two')
	})
})

describe('document_section.section — what it refuses', () => {
	it('prefers an exact heading over a longer one that starts with it', () => {
		const markdown = [`## ${LANES}`, 'exact', '', `## ${LANES} — the long one`, 'prefixed'].join(
			'\n',
		)

		expect(document_section.section(markdown, LANES)?.text).toContain('exact')
	})

	it('refuses an ambiguous prefix rather than returning the first match', () => {
		expect(document_section.section(AMBIGUOUS, `${LANES} are`)).toBeUndefined()
	})

	it('names both candidates of an ambiguous prefix', () => {
		expect(document_section.candidates(AMBIGUOUS, `${LANES} are`)).toHaveLength(2)
	})

	it('answers undefined for a heading the document does not have', () => {
		expect(document_section.section(FENCED, 'Renamed')).toBeUndefined()
	})
})

describe('document_section — the rest of the surface', () => {
	it('lists every heading outside a fence, in document order', () => {
		expect(document_section.titles(FENCED)).toStrictEqual([TITLE, TOP, SECOND])
	})

	it('answers undefined for a path that is not there, rather than throwing', () => {
		expect(document_section.read_optional('no/such/file.md')).toBeUndefined()
	})
})
