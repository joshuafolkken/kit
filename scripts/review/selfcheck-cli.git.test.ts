import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prose_stale_read } from './prose-stale-read'
import { prose_stale_scan } from './prose-stale-scan'
import { selfcheck_cli } from './selfcheck-cli'

// joshuafolkken/kit#5540, with real git: an untracked file is read as wholly added, the way
// `josh review:selfcheck` counts a new file the diff from the change base does not list.

const TIMEOUT_MS = 30_000
const NEW_FILE = 'new.md'
const NEW_LINE = 'run `pnpm josh a:b`'
const IGNORED_FILE = 'skip.md'
const MOVED_FROM = 'a.ts'
const MOVED_DECLARATION = 'function moved_name(): void {}\n'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace('kit-selfcheck-')

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('selfcheck_cli.untracked_hunks against real git', () => {
	it(
		'reads an untracked file as wholly added and leaves an ignored one out',
		async () => {
			await writeFile(path.join(fixture.root, '.gitignore'), `${IGNORED_FILE}\n`)
			await writeFile(path.join(fixture.root, NEW_FILE), `${NEW_LINE}\n`)
			await writeFile(path.join(fixture.root, IGNORED_FILE), 'ignored\n')

			const hunks = await selfcheck_cli.untracked_hunks(fixture.root)

			expect(hunks.find((hunk) => hunk.file === NEW_FILE)).toStrictEqual({
				file: NEW_FILE,
				new_start: 1,
				new_count: 2,
				old_lines: [],
				new_lines: [NEW_LINE, ''],
			})
			expect(hunks.map((hunk) => hunk.file)).not.toContain(IGNORED_FILE)
		},
		TIMEOUT_MS,
	)
})

describe('selfcheck_cli.change_hunks against real git', () => {
	it(
		'keeps a declaration moved from a tracked file into an untracked one, so q2 reports none',
		async () => {
			await writeFile(path.join(fixture.root, MOVED_FROM), MOVED_DECLARATION)
			await writeFile(path.join(fixture.root, 'docs.md'), 'Call moved_name.\n')
			await git(fixture.root, ['add', '--all'])
			await git(fixture.root, ['commit', '--no-verify', '-m', 'base'])
			await rm(path.join(fixture.root, MOVED_FROM))
			await writeFile(path.join(fixture.root, 'b.ts'), MOVED_DECLARATION)

			const hunks = await selfcheck_cli.change_hunks(fixture.root, 'HEAD')
			const found = await prose_stale_read.references(fixture.root, hunks)

			expect(prose_stale_scan.report(found)).toEqual({ text: 'ok', exit_code: 0 })
		},
		TIMEOUT_MS,
	)
})
