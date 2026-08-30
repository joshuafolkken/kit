import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { markdown_files_under } from './shipped-documents-fixture'

// The layout that broke `gh-document-guard.test.ts`, rebuilt from nothing: a shipped directory
// holding a bridge work tree, and the work tree holding both a document the package does not ship
// and a vendored one. Written as a fixture rather than as an assertion about this repository,
// because the defect is only visible while such a work tree happens to exist on disk — and the
// state the suites have to survive is exactly the one that cannot be relied on to be there.
describe('the shipped-document walk — what it descends into', () => {
	// The one file in the layout the package actually ships, so the assertion names it once.
	const SHIPPED_DOCUMENT = 'skills/workflow-commands/followup.md'
	const workspace = mkdtempSync(path.join(tmpdir(), 'shipped-documents-'))

	afterAll(() => {
		rmSync(workspace, { recursive: true, force: true })
	})

	function write_document(relative_path: string): void {
		const absolute = path.join(workspace, relative_path)

		mkdirSync(path.dirname(absolute), { recursive: true })
		writeFileSync(absolute, '')
	}

	it('reads the shipped documents and nothing a nested checkout brought with it', () => {
		write_document(SHIPPED_DOCUMENT)
		write_document('worktrees/bridge/.git')
		write_document('worktrees/bridge/docs/sync.md')
		write_document('worktrees/bridge/node_modules/dep/CHANGELOG.md')
		write_document('node_modules/dep/CHANGELOG.md')

		expect(markdown_files_under(workspace)).toStrictEqual([SHIPPED_DOCUMENT])
	})
})
