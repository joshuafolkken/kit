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
const { broken_section_references, exists } = section_reference_resolution

// A relative link is resolved against the containing file's directory, then against the repository
// root — a document at the top level writes `docs/x.md`, one in a sub-directory writes `../x.md`.
function link_resolves(from: string, target: string): boolean {
	const resolved = node_path.normalize(node_path.join(node_path.dirname(from), target))

	return exists(resolved) || exists(target)
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
