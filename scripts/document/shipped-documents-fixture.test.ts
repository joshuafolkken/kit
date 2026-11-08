import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { markdown_files_under } from './shipped-documents-fixture'

function write_document(root: string, relative_path: string): void {
	const absolute = path.join(root, relative_path)

	mkdirSync(path.dirname(absolute), { recursive: true })
	writeFileSync(absolute, '')
}

// The layout that broke `gh-document-guard.test.ts`, rebuilt from nothing: a shipped directory
// holding a bridge work tree, and the work tree holding both a document the package does not ship
// and a vendored one. Written as a fixture rather than as an assertion about this repository,
// because the defect is only visible while such a work tree happens to exist on disk — and the
// state the suites have to survive is exactly the one that cannot be relied on to be there.
describe('the shipped-document walk — what it descends into', () => {
	// The one file in the layout the package actually ships, so the assertion names it once.
	const SHIPPED_DOCUMENT = 'skills/workflow-commands/followup.md'
	const make_directory = temporary_directory()

	it('reads the shipped documents and nothing a nested checkout brought with it', () => {
		// Created inside the test, not in the describe body: a body runs at collection time, so a
		// filtered run (`vitest run -t …`) would make the directory and then skip the hook that
		// removes it.
		const workspace = make_directory('shipped-documents-')

		write_document(workspace, SHIPPED_DOCUMENT)
		write_document(workspace, 'worktrees/bridge/.git')
		write_document(workspace, 'worktrees/bridge/docs/sync.md')
		write_document(workspace, 'worktrees/bridge/node_modules/dep/CHANGELOG.md')
		write_document(workspace, 'node_modules/dep/CHANGELOG.md')

		expect(markdown_files_under(workspace)).toStrictEqual([SHIPPED_DOCUMENT])
	})
})
