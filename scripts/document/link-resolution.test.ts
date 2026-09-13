import node_path from 'node:path'
import { all_documents, read_document } from '#scripts/ai-document-fixture'
import { package_file } from '#scripts/skill-fixture'
import { describe, expect, it } from 'vitest'
import { document_scan } from './document-scan'
import { document_section } from './document-section'

// Both cross-document reference forms have to resolve: a relative markdown link to a file that
// exists, and a `` `file.md` → "Heading" `` section reference to an anchor that exists. This one
// scan replaced the scattered pins that named individual citations (joshuafolkken/kit#1923).
//
// An anchor is a markdown heading or a bold label — `- **Cross-package problems → …**`. The
// documents cite both, so resolving only headings would flag every bold-label reference as broken.
// The match is a prefix, exactly as `pnpm josh doc:section` matches a heading, so the gloss that
// follows a title need not be repeated in the reference.

const DOCUMENTS = all_documents()

// A few references cite the reference form itself rather than a real anchor — the doc-section
// explanation writes `"節名"` (Japanese for "section name") as a stand-in.
const EXAMPLE_HEADINGS: ReadonlySet<string> = new Set(['節名', 'Heading', '見出し'])

// Any bold span is a citable anchor: the documents point at `- **Cross-package problems → …**` at a
// line start and at a `**…**` emphasis mid-paragraph alike, and a reference resolves to either.
const BOLD_LABEL_PATTERN = /\*\*([^*]+?)\*\*/gu

function paths_by_base(): Map<string, Array<string>> {
	const index = new Map<string, Array<string>>()

	for (const path of DOCUMENTS) {
		const base = path.split('/').at(-1) ?? path

		index.set(base, [...(index.get(base) ?? []), path])
	}

	return index
}

const BY_BASE = paths_by_base()

function exists(relative_path: string): boolean {
	return document_section.read_optional(package_file(relative_path)) !== undefined
}

// A path reference is repository-relative; a bare name resolves against every document sharing it,
// since `SKILL.md` names one file per skill and a reference picks it out by its heading.
function candidate_paths(file: string): Array<string> {
	if (file.includes('/')) return exists(file) ? [file] : []

	return BY_BASE.get(file) ?? []
}

function anchor_forms(content: string): Array<string> {
	const titles = document_section.headings(content).map((heading) => heading.title)
	const labels = [...content.matchAll(BOLD_LABEL_PATTERN)].map((match) => match[1] ?? '')

	return [...titles, ...labels].flatMap((anchor) => document_scan.reference_forms(anchor))
}

const ANCHORS = new Map<string, Array<string>>()

function anchors_of(path: string): Array<string> {
	const cached = ANCHORS.get(path)

	if (cached !== undefined) return cached

	const forms = anchor_forms(read_document(path))

	ANCHORS.set(path, forms)

	return forms
}

function reference_resolves(file: string, heading: string): boolean {
	if (EXAMPLE_HEADINGS.has(heading)) return true

	const wanted = document_scan.normalize_reference(heading)

	return candidate_paths(file).some((path) =>
		anchors_of(path).some((anchor) => anchor.startsWith(wanted)),
	)
}

function broken_section_references(text: string): Array<string> {
	return document_scan
		.section_references(text)
		.filter((reference) => !reference_resolves(reference.file, reference.heading))
		.map((reference) => `${reference.file} → "${reference.heading}"`)
}

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

	it('flags a relative link to a missing file', () => {
		expect(broken_links('CLAUDE.md', 'see [x](does-not-exist.md)')).toStrictEqual([
			'does-not-exist.md',
		])
	})
})
