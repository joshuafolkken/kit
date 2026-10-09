import { package_file } from '#scripts/claude/skill-fixture'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'
import { document_section } from './document-section'

// Resolves a `` `file.md` → "Heading" `` section reference against the documents. Shared by the
// corpus-wide link scan and by any suite that has to prove its own pointers land (the workflow
// glossary), so the two can never disagree on what "resolves" means.
//
// **What resolves is what `pnpm josh doc:section` resolves — the same function, not a copy of its
// rule**. This fixture once kept its own anchor set, which accepted bold
// labels the command could not find, so a green suite promised sections the command then refused.

// A few references cite the reference form itself rather than a real anchor — the doc-section
// explanation writes a Japanese "section name" placeholder (see EXAMPLE_HEADINGS) as a stand-in.
const EXAMPLE_HEADINGS: ReadonlySet<string> = new Set(['節名', 'Heading', '見出し'])

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

function reference_resolves(file: string, heading: string): boolean {
	if (EXAMPLE_HEADINGS.has(heading)) return true

	return candidate_paths(file).some(
		(path) => document_section.section(read_document(path), heading) !== undefined,
	)
}

function broken_section_references(text: string): Array<string> {
	return document_scan
		.section_references(text)
		.filter((reference) => !reference_resolves(reference.file, reference.heading))
		.map((reference) => `${reference.file} → "${reference.heading}"`)
}

// A reference that names no file — `"Heading" above` or a bare `→ "Heading"` — has only the
// document it sits in to resolve against.
function broken_in_document(text: string, headings: ReadonlyArray<string>): Array<string> {
	return headings
		.filter((heading) => !EXAMPLE_HEADINGS.has(heading))
		.filter((heading) => document_section.section(text, heading) === undefined)
		.map((heading) => `"${heading}"`)
}

function broken_adjacent_references(text: string): Array<string> {
	return broken_in_document(text, document_scan.adjacent_references(text))
}

function broken_bare_arrow_references(text: string): Array<string> {
	return broken_in_document(text, document_scan.bare_arrow_references(text))
}

const section_reference_resolution = {
	broken_adjacent_references,
	broken_bare_arrow_references,
	broken_section_references,
	exists,
}

export { section_reference_resolution }
