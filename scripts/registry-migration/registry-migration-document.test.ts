import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#7654: the path for consumers the migration entry stops on is documented,
// reached from the other entry docs, and never weakens the integrity check.
// joshuafolkken/kit#7680: the document is written in English, so its anchors are English too.
const DOCS_DIR = path.join(import.meta.dirname, '..', '..', 'docs')
const DOCUMENT = 'registry-migration.md'
const HEADING = '## When the entry stops'
const ANCHOR = `${DOCUMENT}#when-the-entry-stops`
const WORK_LEFT_ANCHOR = `${DOCUMENT}#work-left-after-the-migration`
const UTF8 = 'utf8'

function read_document(relative: string): string {
	return readFileSync(path.join(DOCS_DIR, relative), UTF8)
}

function stopped_entry_section(): string {
	const document = read_document(DOCUMENT)
	const start = document.indexOf(HEADING)
	const end = document.indexOf('\n## ', start + HEADING.length)

	return document.slice(start, end)
}

describe('registry-migration.md stopped-entry section', () => {
	it('covers both stop reasons', () => {
		const section = stopped_entry_section()

		expect(section).toContain('pnpm version mismatch:')
		expect(section).toContain('Missing version:')
	})

	it('points the scope at npm and ends with the unauthenticated checks', () => {
		const section = stopped_entry_section()

		expect(section).toContain(
			'pnpm config set --location project "@joshuafolkken:registry" https://registry.npmjs.org/',
		)
		expect(section).toContain('npm.pkg.github.com')
		expect(section).toContain('pnpm exec josh sync')
	})

	it('never recommends disabling checksums or rewriting integrity', () => {
		const section = stopped_entry_section()

		expect(section).not.toMatch(/--no-verify|verify-store-integrity\s*=\s*false|--force/u)
		expect(section).toContain('Never disable checksums or rewrite integrity.')
	})

	it.each([
		['troubleshooting.md', ANCHOR],
		[path.join('how-to', 'update-kit.md'), ANCHOR],
		['authentication.md', WORK_LEFT_ANCHOR],
	])('is linked from %s at %s', (relative, anchor) => {
		expect(read_document(relative)).toContain(anchor)
	})
})
