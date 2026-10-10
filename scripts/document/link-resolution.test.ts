import node_path from 'node:path'
import { describe, expect, it } from 'vitest'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'
import { section_reference_resolution } from './section-reference-fixture'

// Both cross-document reference forms have to resolve: a relative markdown link to a file that
// exists, and a `` `file.md` → "Heading" `` section reference to an anchor that exists. This one
// scan replaced the scattered pins that named individual citations (joshuafolkken/kit#1923). What
// counts as an anchor is `section-reference-fixture.ts`'s, shared with the workflow glossary.

const DOCUMENTS = all_documents()
const {
	broken_adjacent_references,
	broken_bare_arrow_references,
	broken_section_references,
	exists,
} = section_reference_resolution

// A bare `→ "Heading"` is a same-document reference only in the skills; the prompts write one as
// shorthand that continues the file the sentence named before it, so it is scanned here alone.
const SKILL_DOCUMENTS = DOCUMENTS.filter((path) => path.startsWith('.claude/skills/'))

// A relative link is resolved against the containing file's directory only, because that is how
// GitHub renders it — a repository-root fallback would pass a link that breaks on the page
// (joshuafolkken/kit#3248).
function link_resolves(from: string, target: string): boolean {
	const joined = node_path.join(node_path.dirname(from), target)

	return exists(node_path.normalize(joined))
}

function broken_links(from: string, text: string): Array<string> {
	return document_scan.link_targets(text).filter((target) => !link_resolves(from, target))
}

describe('every cross-document reference resolves', () => {
	it.each(DOCUMENTS)('%s — section references resolve', (path) => {
		expect(broken_section_references(read_document(path))).toStrictEqual([])
	})

	it.each(DOCUMENTS)('%s — relative links resolve', (path) => {
		expect(broken_links(path, read_document(path))).toStrictEqual([])
	})

	// The guard is only worth keeping if it fails on the references it exists to catch.
	it('flags a section reference to a missing heading', () => {
		expect(broken_section_references('`CLAUDE.md` → "No Such Heading Here"')).not.toStrictEqual([])
	})

	it('flags a reference that carries a section number or no code span', () => {
		const text =
			'`SKILL.md` → §1, "No Such Heading Here" and (chain-rule.md →\n"No Such Heading Either")'

		expect(broken_section_references(text)).toStrictEqual([
			'SKILL.md → "No Such Heading Here"',
			'chain-rule.md → "No Such Heading Either"',
		])
	})

	it('flags a reference whose file name is a markdown link', () => {
		const text = 'see [`chain-rule.md`](./chain-rule.md) →「No Such Heading Here」'

		expect(broken_section_references(text)).toStrictEqual([
			'chain-rule.md → "No Such Heading Here"',
		])
	})

	it('reads no section reference out of a URL or an unpaired code span', () => {
		const text =
			'https://github.com/o/r/blob/main/docs/x/missing.md → "No Such Heading Here" and `missing.md → "No Such Heading Either"'

		expect(broken_section_references(text)).toStrictEqual([])
	})

	it('flags a relative link to a missing file', () => {
		expect(broken_links('CLAUDE.md', 'see [x](does-not-exist.md)')).toStrictEqual([
			'does-not-exist.md',
		])
	})
})

describe('every reference that names no file resolves in its own document', () => {
	const missing = '"No Such Heading Here"'

	it.each(DOCUMENTS)('%s — "Heading" above / below resolves', (path) => {
		expect(broken_adjacent_references(read_document(path))).toStrictEqual([])
	})

	it.each(SKILL_DOCUMENTS)('%s — a bare → "Heading" resolves', (path) => {
		expect(broken_bare_arrow_references(read_document(path))).toStrictEqual([])
	})

	it('flags an above / below reference to a heading the document lacks', () => {
		const text = `## Present\n\nSee "Present" above and\n${missing} below.`

		expect(broken_adjacent_references(text)).toStrictEqual([missing])
	})

	it('flags a bare arrow to a missing heading and leaves a filed one to the section scan', () => {
		const text = `## Present\n\n→ "Present", → ${missing} and \`CLAUDE.md\` → "Other"`

		expect(broken_bare_arrow_references(text)).toStrictEqual([missing])
	})
})

describe('the scan answers as GitHub and `doc:section` do', () => {
	it('flags a link that resolves only from the repository root', () => {
		expect(broken_links('docs/how-to.md', 'see [x](docs/cli.md)')).toStrictEqual(['docs/cli.md'])
	})

	it('scans README.md with the rest of the corpus', () => {
		expect(DOCUMENTS).toContain('README.md')
	})

	// The symptom joshuafolkken/kit#3248 was filed on: a bold-label reference the scan accepted and
	// `pnpm josh doc:section CLAUDE.md "Output language"` refused. Both now answer from one function.
	it('resolves a bold-label reference the way the command does', () => {
		expect(broken_section_references('`CLAUDE.md` → "Output language"')).toStrictEqual([])
	})
})
