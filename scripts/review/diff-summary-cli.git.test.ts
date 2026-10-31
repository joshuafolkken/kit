import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diff_summary_cli } from './diff-summary-cli'

// joshuafolkken/kit#5547, with real git: `josh diff:summary` saves the full diff inside the git
// directory, where `git status` never lists it as a working-tree change.

const TIMEOUT_MS = 30_000
const FILE = 'a.ts'
const SAVED_PREFIX = 'full output: '

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace('kit-diff-summary-')

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await writeFile(path.join(fixture.root, FILE), 'const a = 1\n')
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', 'base'])
	process.chdir(fixture.root)
}, TIMEOUT_MS)

afterEach(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(fixture)
})

function printed(spy: { mock: { calls: Array<Array<unknown>> } }): string {
	return spy.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('diff_summary_cli.run against real git', () => {
	it(
		'saves the full diff under the git directory, unseen by git status',
		async () => {
			await writeFile(path.join(fixture.root, FILE), 'const a = 2\n')
			const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

			expect(await diff_summary_cli.run(['HEAD'])).toBe(0)

			const saved = printed(info).split('\n').at(-1)?.slice(SAVED_PREFIX.length) ?? ''
			const git_directory = await git(fixture.root, ['rev-parse', '--absolute-git-dir'])

			expect(path.dirname(saved)).toBe(git_directory)
			expect(await readFile(saved, 'utf8')).toContain('+const a = 2')
			expect(await git(fixture.root, ['status', '--porcelain'])).toBe(` M ${FILE}`)
		},
		TIMEOUT_MS,
	)

	it(
		'prints one line when the tree matches the base',
		async () => {
			const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

			expect(await diff_summary_cli.run(['HEAD'])).toBe(0)
			expect(printed(info)).toBe('diff:summary: no changes against HEAD')
		},
		TIMEOUT_MS,
	)
})
