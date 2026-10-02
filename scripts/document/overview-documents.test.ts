import { readdirSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { linked_paths, read_document } from './ai-document-fixture'

// The README stays short (joshuafolkken/kit#2917): it links a handful of pages and hands the full
// list to the overview. A top-level docs page is only reachable while the overview links it.
const OVERVIEW = 'docs/overview.md'
const DOCS_DIRECTORY = 'docs'

function top_level_pages(): Array<string> {
	return readdirSync(package_file(DOCS_DIRECTORY), { encoding: 'utf8' })
		.filter((entry) => entry.endsWith('.md'))
		.map((entry) => `${DOCS_DIRECTORY}/${entry}`)
		.filter((path) => path !== OVERVIEW)
}

describe('the overview documentation list', () => {
	it('links every top-level docs page', () => {
		const linked = new Set(linked_paths(OVERVIEW))

		expect(top_level_pages().filter((path) => !linked.has(path))).toStrictEqual([])
	})

	it('is linked from the README and carries the Documentation heading', () => {
		expect(linked_paths('README.md')).toContain(OVERVIEW)
		expect(read_document(OVERVIEW)).toContain('\n## Documentation\n')
	})
})
