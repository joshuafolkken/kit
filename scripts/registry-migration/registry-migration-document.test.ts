import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#7654: the path for consumers the migration entry stops on is documented,
// reached from the other entry docs, and never weakens the integrity check.
const DOCS_DIR = path.join(import.meta.dirname, '..', '..', 'docs')
const HEADING = '## 入口が停止する配布先'
const ANCHOR = 'registry-migration.md#入口が停止する配布先'
const UTF8 = 'utf8'

function read_document(relative: string): string {
	return readFileSync(path.join(DOCS_DIR, relative), UTF8)
}

function stopped_entry_section(): string {
	const document = read_document('registry-migration.md')
	const start = document.indexOf(HEADING)
	const end = document.indexOf('\n## ', start + HEADING.length)

	return document.slice(start, end)
}

describe('registry-migration.md stopped-entry section', () => {
	it('covers both stop reasons', () => {
		const section = stopped_entry_section()

		expect(section).toContain('pnpm 版違い')
		expect(section).toContain('不足版')
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
		expect(section).toContain('checksum 無効化や integrity の書き換えはしない')
	})

	it.each(['troubleshooting.md', path.join('how-to', 'update-kit.md')])(
		'is linked from %s',
		(relative) => {
			expect(read_document(relative)).toContain(ANCHOR)
		},
	)
})
