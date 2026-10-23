import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { split_measure } from './split-measure'

// joshuafolkken/kit#4696, with real git: #4645's lane was warned of 53 files / 1100 lines while its
// own change was 10 files. The measurement ran while a merge of the default branch had stopped on a
// conflict — the default branch's files were already in the tree, `HEAD` was still the commit before
// the merge, and the diff from `HEAD`'s merge-base counted everything the merge brought in. Only the
// stopped merge itself demonstrates it, so this file builds one.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-split-measure-'
const LANE_BRANCH = 'lane'
const SHARED_FILE = 'shared.ts'
const INCOMING_FILE_COUNT = 11
const INCOMING_FILE_LINES = 50

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', message])
}

async function write_incoming_files(): Promise<void> {
	const content = 'line\n'.repeat(INCOMING_FILE_LINES)
	const names = Array.from(
		{ length: INCOMING_FILE_COUNT },
		(_unused, index) => `incoming-${String(index)}.ts`,
	)

	await Promise.all(
		names.map(async (name) => {
			await writeFile(path.join(fixture.root, name), content)
		}),
	)
}

// The lane and the default branch both edit one file, so merging the default branch stops on it
// with the default branch's eleven new files already in the tree.
async function commit_shared(side: string): Promise<void> {
	await writeFile(path.join(fixture.root, SHARED_FILE), `${side}\n`)
	await commit_all(side)
}

async function stop_a_merge_on_a_conflict(): Promise<void> {
	await commit_shared('base')
	await git(fixture.root, ['switch', '-c', LANE_BRANCH])
	await commit_shared('lane')
	await git(fixture.root, ['switch', 'main'])
	await write_incoming_files()
	await commit_shared('main')
	await git(fixture.root, ['switch', LANE_BRANCH])
	await expect(git(fixture.root, ['merge', 'main'])).rejects.toThrow()
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await stop_a_merge_on_a_conflict()
	process.chdir(fixture.root)
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('read_branch during a merge stopped on a conflict', () => {
	it(
		'counts the branch’s own file, not the files the merge brought in',
		async () => {
			const measurement = await split_measure.read_branch()

			expect(measurement.files).toBe(1)
			expect(measurement.lines).toBeLessThan(INCOMING_FILE_LINES)
			expect(measurement.verdict).toBe('single')
		},
		TIMEOUT_MS,
	)
})
