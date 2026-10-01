import { describe, expect, it } from 'vitest'
import { all_documents, linked_paths, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// The setup guides (joshuafolkken/kit#2826): one page per profile under `docs/setup/`, each the
// detailed version of the README Quick start. They only stay reachable while the Quick start links
// to them as its details and the overview routes readers to them. Their link on to the tutorial is
// pinned by the tutorial's own suite.
const SETUP_PAGES: ReadonlyArray<string> = ['docs/setup/basic.md', 'docs/setup/full.md']
const README = 'README.md'
const QUICK_START_HEADING = '## Quick start'
const NEXT_README_HEADING = '## Documentation'
const ENTRY_DOCUMENTS: ReadonlyArray<string> = [README, 'docs/overview.md']

function quick_start_links(): Array<string> {
	const text = read_document(README)
	const start = text.indexOf(QUICK_START_HEADING)
	const end = text.indexOf(NEXT_README_HEADING, start)

	expect(start).not.toBe(-1)
	expect(end).not.toBe(-1)

	return document_scan
		.link_targets(text.slice(start, end))
		.map((target) => target.replace(/^\.\//u, ''))
}

describe('the setup guides', () => {
	it('puts every setup page in the scanned document set', () => {
		const scanned = new Set(all_documents())

		expect(SETUP_PAGES.filter((path) => !scanned.has(path))).toStrictEqual([])
	})

	it.each(SETUP_PAGES)('the README Quick start links to %s as its details', (path) => {
		expect(quick_start_links()).toContain(path)
	})

	it.each(ENTRY_DOCUMENTS)('%s links to every setup page', (from) => {
		const linked = new Set(linked_paths(from))

		expect(SETUP_PAGES.filter((path) => !linked.has(path))).toStrictEqual([])
	})

	it.each(SETUP_PAGES)('%s links back to the README Quick start', (path) => {
		expect(linked_paths(path)).toContain(README)
	})
})
