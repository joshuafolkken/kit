import { readdirSync } from 'node:fs'
import node_path from 'node:path'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// The task-oriented how-to layer (joshuafolkken/kit#2713): one index, one page per task. The pages
// only earn their keep while the command-name and link-resolution scans walk them, and while the
// index reaches every page and the entry documents reach the index.
const HOW_TO_INDEX = 'docs/how-to.md'
const HOW_TO_DIRECTORY = 'docs/how-to'
const ENTRY_DOCUMENTS: ReadonlyArray<string> = ['README.md', 'docs/overview.md']

function how_to_pages(): Array<string> {
	return readdirSync(package_file(HOW_TO_DIRECTORY), { encoding: 'utf8' })
		.filter((entry) => entry.endsWith('.md'))
		.map((entry) => `${HOW_TO_DIRECTORY}/${entry}`)
}

// Link targets resolved to repository-relative paths, against the linking document's directory.
function linked_paths(from: string): Array<string> {
	const directory = node_path.dirname(from)

	return document_scan
		.link_targets(read_document(from))
		.map((target) => node_path.normalize(node_path.join(directory, target)))
}

describe('the how-to layer', () => {
	it('has pages under the how-to directory', () => {
		expect(how_to_pages().length).toBeGreaterThan(0)
	})

	it('puts the index and every page in the scanned document set', () => {
		const scanned = new Set(all_documents())
		const missing = [HOW_TO_INDEX, ...how_to_pages()].filter((path) => !scanned.has(path))

		expect(missing).toStrictEqual([])
	})

	it('links the index to every page', () => {
		const linked = new Set(linked_paths(HOW_TO_INDEX))
		const unlinked = how_to_pages().filter((path) => !linked.has(path))

		expect(unlinked).toStrictEqual([])
	})

	it.each(ENTRY_DOCUMENTS)('%s links to the index', (path) => {
		expect(linked_paths(path)).toContain(HOW_TO_INDEX)
	})
})
