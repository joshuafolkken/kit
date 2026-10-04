import { package_file } from '#scripts/claude/skill-fixture'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'
import { document_section } from './document-section'

// Resolves a `` `file.md` → "Heading" `` section reference against the documents. Shared by the
// corpus-wide link scan and by any suite that has to prove its own pointers land (the workflow
// glossary), so the two can never disagree on what "resolves" means.
//
// An anchor is a markdown heading or a bold label — `- **Cross-package problems → …**`. The
// documents cite both, so resolving only headings would flag every bold-label reference as broken.
// The match is a prefix, exactly as `pnpm josh doc:section` matches a heading, so the gloss that
// follows a title need not be repeated in the reference.

// A few references cite the reference form itself rather than a real anchor — the doc-section
// explanation writes a Japanese "section name" placeholder (see EXAMPLE_HEADINGS) as a stand-in.
const EXAMPLE_HEADINGS: ReadonlySet<string> = new Set(['節名', 'Heading', '見出し'])

// Any bold span is a citable anchor: the documents point at `- **Cross-package problems → …**` at a
// line start and at a `**…**` emphasis mid-paragraph alike, and a reference resolves to either.
const BOLD_LABEL_PATTERN = /\*\*([^*]+?)\*\*/gu

function paths_by_base(): Map<string, Array<string>> {
	const index = new Map<string, Array<string>>()

	for (const path of all_documents()) {
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

const section_reference_resolution = { broken_section_references, exists }

export { section_reference_resolution }
