import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { document_scan } from './document-scan'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'

// joshuafolkken/kit#2762. The rationale behind a workflow procedure document lives beside it under
// `docs/maintainers/`, off every run's read path. These pins keep the move honest: each rationale
// document is cited by the procedure it explains, every section in it is reachable from there, and
// no entry's read set ever counts one — so the reasons are one hop away rather than lost, and the
// tokens a run no longer reads stay unread.

const ROOT = process.cwd()
const RATIONALE_DIRECTORY = path.join('docs', 'maintainers')
const RATIONALE_SUFFIX = '-rationale.md'
const SECTION_LEVEL = 2
const SKILL_ROOT = path.join('.claude', 'skills')
const SKILL_FILE = 'SKILL.md'
const TOPIC_DIRECTORY = path.join('prompts', 'collaboration-workflow')

function rationale_files(): Array<string> {
	return readdirSync(path.join(ROOT, RATIONALE_DIRECTORY))
		.filter((name) => name.endsWith(RATIONALE_SUFFIX))
		.map((name) => `${RATIONALE_DIRECTORY}/${name}`)
}

function read(relative_path: string): string {
	return readFileSync(path.join(ROOT, relative_path), 'utf8')
}

// A workflow procedure file first; a canonical topic file when the rationale explains one that holds
// its own body (`residency-rationale.md`, joshuafolkken/kit#2891); a whole skill's `SKILL.md` when the
// rationale is named after a skill (`epic-commands-rationale.md`, joshuafolkken/kit#2892).
function procedure_of(rationale: string): string {
	const name = path.basename(rationale).replace(RATIONALE_SUFFIX, '')
	const candidates = [
		path.join(entry_read_set.SKILL_DIRECTORY, `${name}.md`),
		path.join(TOPIC_DIRECTORY, `${name}.md`),
	]

	return (
		candidates.find((candidate) => existsSync(path.join(ROOT, candidate))) ??
		path.join(SKILL_ROOT, name, SKILL_FILE)
	)
}

function section_titles(markdown: string): Array<string> {
	return document_section
		.headings(markdown)
		.filter((heading) => heading.level === SECTION_LEVEL)
		.map((heading) => document_scan.normalize_reference(heading.title))
}

function cited_headings(procedure_text: string, rationale: string): Array<string> {
	return document_scan
		.section_references(procedure_text)
		.filter((reference) => reference.file === rationale)
		.map((reference) => document_scan.normalize_reference(reference.heading))
}

function uncited_sections(
	rationale: string,
	procedure_text: string,
	markdown: string,
): Array<string> {
	const cited = cited_headings(procedure_text, rationale)

	return section_titles(markdown).filter((title) => !cited.includes(title))
}

function files_read_by(entry: string): Array<string> {
	const cost = entry_read_set.costed(ROOT, entry)

	return [...cost.files, ...cost.sections, ...cost.point_of_use].map((item) => item.file)
}

const RATIONALE_FILES = rationale_files()

describe('workflow rationale documents sit off the read path', () => {
	it('at least one procedure has had its rationale moved out', () => {
		expect(RATIONALE_FILES.length).toBeGreaterThan(0)
	})

	it.each(RATIONALE_FILES)('%s — has at least one section', (rationale) => {
		expect(section_titles(read(rationale)).length).toBeGreaterThan(0)
	})

	it.each(RATIONALE_FILES)('%s — every section is cited by its procedure', (rationale) => {
		const procedure_text = read(procedure_of(rationale))

		expect(uncited_sections(rationale, procedure_text, read(rationale))).toStrictEqual([])
	})

	it.each(entry_read_set.entries(ROOT))('%s — reads no rationale document', (entry) => {
		const read_files = files_read_by(entry).map((file) => path.basename(file))
		const rationale_names = new Set(RATIONALE_FILES.map((file) => path.basename(file)))

		expect(read_files.filter((file) => rationale_names.has(file))).toStrictEqual([])
	})

	it('maps a rationale named after a skill to that skill', () => {
		expect(procedure_of('docs/maintainers/epic-commands-rationale.md')).toBe(
			path.join(SKILL_ROOT, 'epic-commands', SKILL_FILE),
		)
	})

	it('maps a rationale named after a canonical topic file to that topic', () => {
		expect(procedure_of('docs/maintainers/residency-rationale.md')).toBe(
			path.join(TOPIC_DIRECTORY, 'residency.md'),
		)
	})

	it('flags a rationale section its procedure never cites', () => {
		const rationale = 'docs/maintainers/example-rationale.md'
		const markdown = '# Example\n\n## Cited\n\n## Orphaned\n'
		const procedure_text = `Rationale: \`${rationale}\` → "Cited".`

		expect(uncited_sections(rationale, procedure_text, markdown)).toStrictEqual(['Orphaned'])
	})
})
