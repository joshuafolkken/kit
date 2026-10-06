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

const OUTPUT_LANGUAGE = 'Output language'
const REAL_LABEL_ITEM = '- **Real label** body'
const HEADING_BODY = 'heading body'

// The shape CLAUDE.md cites as `CLAUDE.md` → "Output language" (joshuafolkken/kit#3248).
const LABELLED = [
	'## Communication',
	'',
	'- **Fix root causes, not symptoms.** Surface the root cause.',
	`- **${OUTPUT_LANGUAGE} follows the session setting** (default \`ja\`) for prose.`,
	'  - a nested note that belongs to it',
	'- **Cite an Issue with a link.** Next sibling.',
	'',
	'```bash',
	'echo "**Fenced label** is quoted code"',
	'```',
	'',
	'## Output',
	HEADING_BODY,
].join('\n')

describe('document_section.section — bold-label anchors', () => {
	it('resolves a reference to a bold label as the list item it opens', () => {
		const found = document_section.section(LABELLED, OUTPUT_LANGUAGE)

		expect(found?.text).toBe(LABELLED.split('\n').slice(3, 5).join('\n'))
	})

	it('prefers a heading to a label that shares its prefix', () => {
		expect(document_section.section(LABELLED, 'Output')?.text).toContain(HEADING_BODY)
	})

	it('finds no label inside a fenced block', () => {
		expect(document_section.section(LABELLED, 'Fenced label')).toBeUndefined()
	})

	it('keeps an unpaired `**` inside a fence from swallowing the labels after it', () => {
		const markdown = ['```bash', 'ls docs/**', '```', '', REAL_LABEL_ITEM, '- **Other** x']

		expect(document_section.section(markdown.join('\n'), 'Real label')?.text).toBe(REAL_LABEL_ITEM)
	})

	it('keeps a `**` inside an inline code span from shifting the labels after it', () => {
		const later = '**Later label** body'
		const markdown = ['**Glob note.** See `prompts/**` and', '', later]

		expect(document_section.section(markdown.join('\n'), 'Later label')?.text).toBe(later)
	})

	it('keeps inline code that a label quotes in its title', () => {
		const markdown = '- **Run `pnpm josh gate` first** body'

		expect(document_section.section(markdown, 'Run `pnpm josh gate` first')?.text).toBe(markdown)
	})

	it('suggests only headings when a heading prefix is ambiguous', () => {
		const markdown = ['## Lane one', '## Lane two', '- **Lane label** x'].join('\n')

		expect(document_section.candidates(markdown, 'Lane')).toStrictEqual(['Lane one', 'Lane two'])
	})
})

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
