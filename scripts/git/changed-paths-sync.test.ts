import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changed_paths_sync } from './changed-paths-sync'

// joshuafolkken/kit#4946, with real git: the investigation hook reads the branch's own change
// synchronously, so a resumed session's re-read of a file an earlier session wrote is not investigation.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-changed-paths-sync-'
const LANE_BRANCH = 'lane'
const BASE_FILE = 'base.ts'
const COMMITTED_FILE = 'scripts/committed.ts'
const UNCOMMITTED_FILE = 'base.ts'
const UNTRACKED_FILE = 'scripts/untracked.ts'
const MAIN_ONLY_FILE = 'main-only.ts'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function write(relative: string, content: string): Promise<void> {
	await mkdir(path.dirname(path.join(fixture.root, relative)), { recursive: true })
	await writeFile(path.join(fixture.root, relative), content)
}

async function commit_file(relative: string, content: string): Promise<void> {
	await write(relative, content)
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', relative])
}

// The default branch advances after the lane is cut, so a two-dot diff against it would list its file.
async function build_lane(): Promise<void> {
	await commit_file(BASE_FILE, 'base\n')
	await git(fixture.root, ['switch', '-c', LANE_BRANCH])
	await commit_file(COMMITTED_FILE, 'lane\n')
	await git(fixture.root, ['switch', 'main'])
	await commit_file(MAIN_ONLY_FILE, 'main\n')
	await git(fixture.root, ['switch', LANE_BRANCH])
	await write(UNCOMMITTED_FILE, 'edited\n')
	await write(UNTRACKED_FILE, 'new\n')
}

// joshuafolkken/kit#5309: a merge of the default branch stopped on a conflict, so `HEAD` is still the
// lane's commit while the default branch's own file already sits in the tree.
async function stop_merge_on_conflict(): Promise<void> {
	await commit_file(BASE_FILE, 'base\n')
	await git(fixture.root, ['switch', '-c', LANE_BRANCH])
	await commit_file(COMMITTED_FILE, 'lane\n')
	await commit_file(BASE_FILE, 'lane\n')
	await git(fixture.root, ['switch', 'main'])
	await commit_file(BASE_FILE, 'main\n')
	await commit_file(MAIN_ONLY_FILE, 'main\n')
	await git(fixture.root, ['switch', LANE_BRANCH])
	await expect(git(fixture.root, ['merge', 'main'])).rejects.toThrow(/CONFLICT/u)
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('read_changed_paths', () => {
	it(
		'lists the committed, uncommitted and untracked change since the merge base',
		async () => {
			await build_lane()

			const changed = changed_paths_sync.read_changed_paths(fixture.root)

			expect(new Set(changed)).toStrictEqual(
				new Set([COMMITTED_FILE, UNCOMMITTED_FILE, UNTRACKED_FILE]),
			)
		},
		TIMEOUT_MS,
	)

	it(
		'measures through a merge in progress, so a file only the default branch brought in is not listed',
		async () => {
			await stop_merge_on_conflict()

			const changed = changed_paths_sync.read_changed_paths(fixture.root)

			expect(new Set(changed)).toStrictEqual(new Set([COMMITTED_FILE, BASE_FILE]))
		},
		TIMEOUT_MS,
	)

	it(
		'is empty where git cannot answer',
		() => {
			expect(changed_paths_sync.read_changed_paths(fixture.workspace)).toStrictEqual([])
		},
		TIMEOUT_MS,
	)
})
