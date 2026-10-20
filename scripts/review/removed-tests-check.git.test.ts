import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GIT_BINARY_KEY } from '#scripts/git/constants'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./review-code-tree', () => ({ review_code_tree: { load_typescript: () => ts } }))

const { removed_tests_check } = await import('./removed-tests-check')

// joshuafolkken/kit#4335: a lane resumed with `josh ship` while its merge of the default branch is
// still uncommitted — the work tree already lacks the tests the default branch removed, and only the
// base read through `MERGE_HEAD` keeps them off this change's list. Asserted against real git, since
// what is pinned is the merge state git leaves.

const WORKSPACE_PREFIX = 'kit-removed-tests-merge-'
const REPOSITORY = 'repository'
const DEFAULT_BRANCH = 'main'
const LANE_BRANCH = '4335-lane'
const SUITE = 'suite.test.ts'
const CONFLICTED = 'notes.txt'
const SUITE_AT_BASE =
	"it('kept', () => {})\nit('main drops', () => {})\nit('lane drops', () => {})\n"
const SUITE_ON_MAIN = "it('kept', () => {})\nit('lane drops', () => {})\n"
const SUITE_ON_LANE = "it('kept', () => {})\nit('main drops', () => {})\n"
const SUITE_MERGED = "it('kept', () => {})\n"
const LANE_DROPS = 'lane drops'
const TIMEOUT_MS = 30_000

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace & { repository_root: string } = {
	workspace: '',
	previous_cwd: '',
	repository_root: '',
	restore_environment: undefined,
}

async function write_file(file: string, content: string): Promise<void> {
	await writeFile(path.join(fixture.repository_root, file), content)
}

async function commit(files: Readonly<Record<string, string>>, subject: string): Promise<void> {
	await Promise.all(
		Object.entries(files).map(async ([file, content]) => {
			await write_file(file, content)
		}),
	)
	await git(fixture.repository_root, ['add', ...Object.keys(files)])
	await git(fixture.repository_root, ['commit', '--no-verify', '-m', subject])
}

// Both sides change `CONFLICTED`, so the merge into the lane stops with the suite already merged.
async function stop_merge_on_conflict(lane_suite: string): Promise<void> {
	await git(fixture.repository_root, ['checkout', '-b', LANE_BRANCH])
	await commit({ [SUITE]: lane_suite, [CONFLICTED]: 'lane\n' }, 'lane')
	await git(fixture.repository_root, ['checkout', DEFAULT_BRANCH])
	await commit({ [SUITE]: SUITE_ON_MAIN, [CONFLICTED]: 'main\n' }, 'main')
	await git(fixture.repository_root, ['checkout', LANE_BRANCH])
	await expect(git(fixture.repository_root, ['merge', DEFAULT_BRANCH])).rejects.toThrow()
	await write_file(CONFLICTED, 'resolved\n')
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace(WORKSPACE_PREFIX))
	fixture.repository_root = path.join(fixture.workspace, REPOSITORY)
	await git(fixture.workspace, ['init', MAIN_BRANCH, REPOSITORY])
	await commit({ [SUITE]: SUITE_AT_BASE, [CONFLICTED]: 'base\n' }, 'base')
	process.chdir(fixture.repository_root)
	vi.stubEnv(GIT_BINARY_KEY, '')
}, TIMEOUT_MS)

afterEach(async () => {
	vi.unstubAllEnvs()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('removed_tests_check.read — a merge of the default branch still in progress', () => {
	it(
		'does not count a test the default branch removed as this change removing it',
		async () => {
			await stop_merge_on_conflict(SUITE_AT_BASE)

			await expect(removed_tests_check.read()).resolves.toStrictEqual([])
		},
		TIMEOUT_MS,
	)

	it(
		'still counts the test this branch removed',
		async () => {
			await stop_merge_on_conflict(SUITE_ON_LANE)
			await write_file(SUITE, SUITE_MERGED)

			await expect(removed_tests_check.read()).resolves.toStrictEqual([LANE_DROPS])
		},
		TIMEOUT_MS,
	)
})

describe('removed_tests_check.read — no merge in progress', () => {
	it(
		'counts the test this branch removed from the branch point',
		async () => {
			await git(fixture.repository_root, ['checkout', '-b', LANE_BRANCH])
			await commit({ [SUITE]: SUITE_ON_LANE }, 'lane')

			await expect(removed_tests_check.read()).resolves.toStrictEqual([LANE_DROPS])
		},
		TIMEOUT_MS,
	)
})
