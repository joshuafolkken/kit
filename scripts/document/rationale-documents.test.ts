import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agent_read_documents, linked_paths } from './ai-document-fixture'
import { document_scan } from './document-scan'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'

// joshuafolkken/kit#2762, joshuafolkken/kit#3928. The rationale behind a workflow procedure document
// lives beside it under `docs/maintainers/`, off every run's read path. The reference runs one way
// only, rationale to procedure: each rationale document names the procedure it explains, no document
// an agent reads cites a rationale document, and no entry's read set ever counts one — so a pointer
// never invites a run to spend tokens on history.

const ROOT = process.cwd()
const RATIONALE_DIRECTORY = path.join('docs', 'maintainers')
const RATIONALE_SUFFIX = '-rationale.md'
const SECTION_LEVEL = 2
const SKILL_ROOT = path.join('.claude', 'skills')
const SKILL_FILE = 'SKILL.md'
const TOPIC_DIRECTORY = path.join('prompts', 'collaboration-workflow')
const DOCS_DIRECTORY = 'docs'
const RATIONALE_POINTER = /docs\/maintainers\/[\w.-]+\.md/gu

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
// rationale is named after a skill (`epic-commands-rationale.md`, joshuafolkken/kit#2892); a
// maintainer page beside it (`eval-rationale.md`, joshuafolkken/kit#3343); a consumer-facing page
// under `docs/` when it is named after none of them (`sync-rationale.md`, joshuafolkken/kit#2896).
function procedure_of(rationale: string): string {
	const name = path.basename(rationale).replace(RATIONALE_SUFFIX, '')
	const candidates = [
		path.join(entry_read_set.SKILL_DIRECTORY, `${name}.md`),
		path.join(TOPIC_DIRECTORY, `${name}.md`),
		path.join(SKILL_ROOT, name, SKILL_FILE),
		path.join(RATIONALE_DIRECTORY, `${name}.md`),
	]

	return (
		candidates.find((candidate) => existsSync(path.join(ROOT, candidate))) ??
		path.join(DOCS_DIRECTORY, `${name}.md`)
	)
}

function section_titles(markdown: string): Array<string> {
	return document_section
		.headings(markdown)
		.filter((heading) => heading.level === SECTION_LEVEL)
		.map((heading) => document_scan.normalize_reference(heading.title))
}

// Named as a path in the text, or as a markdown link resolved against the rationale's directory.
function names_procedure(rationale: string): boolean {
	const procedure = procedure_of(rationale)

	return read(rationale).includes(procedure) || linked_paths(rationale).includes(procedure)
}

// A concrete rationale path only: the `<topic>` placeholder and the bare directory name a convention
// and point nowhere.
function rationale_pointers(markdown: string): Array<string> {
	return markdown.match(RATIONALE_POINTER) ?? []
}

// The command references under `docs/` still carry their pointers; they are agent-read but outside
// joshuafolkken/kit#3928, so the prompts, the skills and the rule document are what this pins.
function pointer_free_documents(): Array<string> {
	return agent_read_documents().filter((file) => !file.startsWith(`${DOCS_DIRECTORY}/`))
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

	it.each(RATIONALE_FILES)('%s — names the procedure it explains', (rationale) => {
		expect(names_procedure(rationale), procedure_of(rationale)).toBe(true)
	})

	it.each(pointer_free_documents())('%s — cites no rationale document', (document) => {
		expect(rationale_pointers(read(document))).toStrictEqual([])
	})

	it.each(entry_read_set.entries(ROOT))('%s — reads no rationale document', (entry) => {
		const read_files = files_read_by(entry).map((file) => path.basename(file))
		const rationale_names = new Set(RATIONALE_FILES.map((file) => path.basename(file)))

		expect(read_files.filter((file) => rationale_names.has(file))).toStrictEqual([])
	})

	it('flags a pointer to a rationale document', () => {
		const markdown = 'Rationale: `docs/maintainers/example-rationale.md` → "Why".'

		expect(rationale_pointers(markdown)).toStrictEqual(['docs/maintainers/example-rationale.md'])
	})

	it('ignores the topic placeholder and the bare directory', () => {
		const markdown = 'Put it in `docs/maintainers/<topic>-rationale.md` under `docs/maintainers/`.'

		expect(rationale_pointers(markdown)).toStrictEqual([])
	})
})

describe('a rationale document maps to the procedure it explains', () => {
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

	it('maps a rationale named after a maintainer page to that page beside it', () => {
		expect(procedure_of('docs/maintainers/eval-rationale.md')).toBe(
			path.join(RATIONALE_DIRECTORY, 'eval.md'),
		)
	})

	it('maps a rationale named after none of them to the consumer-facing page under docs/', () => {
		expect(procedure_of('docs/maintainers/sync-rationale.md')).toBe(
			path.join(DOCS_DIRECTORY, 'sync.md'),
		)
	})
})
