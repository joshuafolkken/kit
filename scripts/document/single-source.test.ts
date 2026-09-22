import { describe, expect, it } from 'vitest'
import { single_source, type ReadDocument, type SingleSourceRule } from './single-source'

const CANONICAL = 'CLAUDE.md'
const POINTER = 'AGENTS.md'
const OTHER = 'GEMINI.md'
const MARKER = 'the rule body lives in exactly one place'
const RULE: SingleSourceRule = { marker: MARKER, canonical: CANONICAL }
const DOCUMENTS: ReadonlyArray<string> = [CANONICAL, POINTER, OTHER]

// A reader over a synthetic corpus, so the pure logic is verified without touching the repository.
function reader(contents: Record<string, string>): ReadDocument {
	return (document_path) => contents[document_path] ?? ''
}

describe('single_source.violations', () => {
	it('finds nothing when only the canonical carries the body', () => {
		const read = reader({ [CANONICAL]: `intro ${MARKER} outro`, [POINTER]: 'see CLAUDE.md' })

		expect(single_source.violations(RULE, DOCUMENTS, read)).toStrictEqual([])
	})

	it('names every other document that copied the body', () => {
		const read = reader({ [CANONICAL]: MARKER, [POINTER]: MARKER, [OTHER]: 'points at it' })

		expect(single_source.violations(RULE, DOCUMENTS, read)).toStrictEqual([POINTER])
	})

	it('matches a body that a reflow wrapped across lines', () => {
		const read = reader({
			[CANONICAL]: MARKER,
			[POINTER]: 'the rule body lives in\nexactly one place',
		})

		expect(single_source.violations(RULE, DOCUMENTS, read)).toStrictEqual([POINTER])
	})
})

describe('single_source.is_single_sourced', () => {
	it('holds when the canonical alone carries the body', () => {
		const read = reader({ [CANONICAL]: MARKER, [POINTER]: 'reference only' })

		expect(single_source.is_single_sourced(RULE, DOCUMENTS, read)).toBe(true)
	})

	it('fails when the body is missing from its canonical home', () => {
		const read = reader({ [CANONICAL]: 'nothing here', [POINTER]: MARKER })

		expect(single_source.is_single_sourced(RULE, DOCUMENTS, read)).toBe(false)
	})

	it('fails when a second document also carries the body', () => {
		const read = reader({ [CANONICAL]: MARKER, [OTHER]: MARKER })

		expect(single_source.is_single_sourced(RULE, DOCUMENTS, read)).toBe(false)
	})
})

describe('single_source.carriers', () => {
	it('lists every document carrying the body, canonical included', () => {
		const read = reader({ [CANONICAL]: MARKER, [POINTER]: MARKER, [OTHER]: 'no' })

		expect(single_source.carriers(MARKER, DOCUMENTS, read)).toStrictEqual([CANONICAL, POINTER])
	})
})
