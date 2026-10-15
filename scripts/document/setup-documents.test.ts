import { readdirSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { all_documents, linked_paths, read_document, read_unwrapped } from './ai-document-fixture'
import { document_scan } from './document-scan'

// The setup guides (joshuafolkken/kit#2826): one page per profile under `docs/setup/`, each the
// detailed version of the README Quick start. They only stay reachable while the overview routes
// readers to them and the Quick start does too: to the prerequisites directly, and to each profile
// guide through the tutorial it names as the one next step. Their link on to the tutorial is pinned
// by the tutorial's own suite.
const PREREQUISITES = 'docs/setup/prerequisites.md'
const PROFILE_GUIDES: ReadonlyArray<string> = ['docs/setup/basic.md', 'docs/setup/full.md']
const SETUP_PAGES: ReadonlyArray<string> = [...PROFILE_GUIDES, PREREQUISITES]
const TUTORIAL = 'docs/tutorial.md'
const README = 'README.md'
const QUICK_START_HEADING = '## Quick start'
const NEXT_README_HEADING = '## Docs'
const OVERVIEW = 'docs/overview.md'
const AUTHENTICATION = 'docs/authentication.md'
const INIT_GUIDE = 'docs/init.md'
const COMMAND_CATALOG = 'docs/josh-command-catalog.md'
const README_POSITIONING = "kit gives Claude Code or Codex your project's rules and checks."
// joshuafolkken/kit#3829: the README sums up what adopting kit into an existing project touches,
// one line each, and leaves the detail to the guide each line links to.
const ADOPTION_HEADING = '### Adding kit to an existing project'
const ADOPTION_DETAILS: ReadonlyArray<string> = [
	'docs/init.md#project-profiles',
	'docs/sync.md#ai-files-overwritten',
	'docs/init.md#claude-code-permission-mode',
	'docs/init.md#josh-init-or-josh-start',
]
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

function readme_section(heading: string, next_heading: string): string {
	const text = read_document(README)
	const start = text.indexOf(heading)
	const end = text.indexOf(next_heading, start + heading.length)

	expect(start).not.toBe(-1)
	expect(end).not.toBe(-1)

	return text.slice(start, end)
}

function quick_start_links(): Array<string> {
	return document_scan
		.link_targets(readme_section(QUICK_START_HEADING, NEXT_README_HEADING))
		.map((target) => target.replace(/^\.\//u, ''))
}

describe('the setup guides', () => {
	it('puts every setup page in the scanned document set', () => {
		const scanned = new Set(all_documents())

		expect(SETUP_PAGES.filter((path) => !scanned.has(path))).toStrictEqual([])
	})

	it.each([PREREQUISITES, TUTORIAL])('the README Quick start links to %s', (path) => {
		expect(quick_start_links()).toContain(path)
	})

	it.each(PROFILE_GUIDES)('the tutorial the Quick start names links to %s', (path) => {
		expect(linked_paths(TUTORIAL)).toContain(path)
	})

	it('the overview links to every setup page', () => {
		const linked = new Set(linked_paths(OVERVIEW))

		expect(SETUP_PAGES.filter((path) => !linked.has(path))).toStrictEqual([])
	})

	it.each(SETUP_PAGES)('%s links back to the README Quick start', (path) => {
		expect(linked_paths(path)).toContain(README)
	})

	it.each(ADOPTION_DETAILS)('the README adoption section links to %s', (target) => {
		expect(readme_section(ADOPTION_HEADING, '\n#')).toContain(`](./${target})`)
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
