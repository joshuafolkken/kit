import { readdirSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { all_documents, linked_paths, read_document, read_unwrapped } from './ai-document-fixture'
import { document_scan } from './document-scan'

// The setup guides (joshuafolkken/kit#2826): one page per profile under `docs/setup/`, each the
// detailed version of the README Quick start. They only stay reachable while the Quick start links
// to them as its details and the overview routes readers to them. Their link on to the tutorial is
// pinned by the tutorial's own suite.
const PREREQUISITES = 'docs/setup/prerequisites.md'
const SETUP_PAGES: ReadonlyArray<string> = [
	'docs/setup/basic.md',
	'docs/setup/full.md',
	PREREQUISITES,
]
const README = 'README.md'
const QUICK_START_HEADING = '## Quick start'
const NEXT_README_HEADING = '## Docs'
const OVERVIEW = 'docs/overview.md'
const ENTRY_DOCUMENTS: ReadonlyArray<string> = [README, OVERVIEW]
const AUTHENTICATION = 'docs/authentication.md'
const INIT_GUIDE = 'docs/init.md'
const COMMAND_CATALOG = 'docs/josh-command-catalog.md'
const README_POSITIONING = "kit gives Claude Code or Codex your project's rules and checks."
// joshuafolkken/kit#3343: each repeated setup note has one home the other user pages link to. The
// marker is a phrase only the full statement carries, never the link that replaces it.
const SINGLE_SOURCE_NOTES: ReadonlyArray<readonly [string, string]> = [
	['22.19', PREREQUISITES],
	['Since pnpm 11.6', AUTHENTICATION],
]

function user_documents(): Array<string> {
	return readdirSync(package_file('docs'), { recursive: true, encoding: 'utf8' })
		.filter((entry) => entry.endsWith('.md') && !entry.startsWith('maintainers/'))
		.map((entry) => `docs/${entry}`)
}

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

describe('the entry pages agree', () => {
	it('states the README positioning in the overview', () => {
		expect(read_unwrapped(README)).toContain(README_POSITIONING)
		expect(read_unwrapped(OVERVIEW)).toContain(README_POSITIONING)
	})

	it('routes the init guide to the command catalog', () => {
		expect(linked_paths(INIT_GUIDE)).toContain(COMMAND_CATALOG)
	})

	it.each(SINGLE_SOURCE_NOTES)('states "%s" only in %s', (marker, home) => {
		const holders = user_documents().filter((path) => read_unwrapped(path).includes(marker))

		expect(holders).toStrictEqual([home])
	})
})
