import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prose_stale_cli } from './prose-stale-cli'
import { prose_stale_scan } from './prose-stale-scan'

// joshuafolkken/kit#5287, with real git: the diff read from a base to the working tree (an uncommitted
// edit and a deleted file both count) and the search over the prose paths, as `josh prose:stale` runs them.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-prose-stale-'
const CODE = 'scripts/a.ts'
const GONE_DOC = 'docs/gone.md'

const { git, MAIN_BRANCH } = git_fixture_workspace

// The change base is the one commit, so the diff is the working tree's edits since it.
const BASE = 'HEAD'

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function write(file: string, content: string): Promise<void> {
	await mkdir(path.dirname(path.join(fixture.root, file)), { recursive: true })
	await writeFile(path.join(fixture.root, file), content)
}

// A name, a heading, and the prose and code that still name them.
async function commit_base(): Promise<void> {
	await write(CODE, 'function old_name(): void {}\n')
	await write(GONE_DOC, '## Old heading\n')
	await write('docs/a.md', 'Call old_name, as → "Old heading" says.\n')
	await write('scripts/b.ts', '// old_name reads it\nold_name()\n')
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', 'base'])
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await commit_base()
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('prose_stale_cli.references against real git', () => {
	it(
		'lists the prose that names an uncommitted removal and a deleted file’s heading, not the code',
		async () => {
			await write(CODE, '')
			await rm(path.join(fixture.root, GONE_DOC))

			const found = await prose_stale_cli.references(fixture.root, BASE)

			expect(prose_stale_scan.report(found).text).toBe(
				'docs/a.md:1 heading Old heading\ndocs/a.md:1 name old_name\nscripts/b.ts:1 name old_name',
			)
		},
		TIMEOUT_MS,
	)

	it(
		'answers ok when the working tree still matches the base',
		async () => {
			const found = await prose_stale_cli.references(fixture.root, BASE)

			expect(prose_stale_scan.report(found)).toEqual({ text: 'ok', exit_code: 0 })
		},
		TIMEOUT_MS,
	)
})
