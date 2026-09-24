import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { gone_branch } from './gone-branch'

const WORKSPACE_PREFIX = 'kit-gone-branch-'
const REPOSITORY = 'repository'
const CANDIDATE = 'candidate'
const LOCAL_UPSTREAM = 'local-upstream'
const DEFAULT_BRANCH = 'main'
const SET_UPSTREAM = '--set-upstream-to'
const TIMEOUT_MS = 30_000

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace & { repository_root: string } = {
	workspace: '',
	previous_cwd: '',
	repository_root: '',
	restore_environment: undefined,
}

async function commit_file(name: string): Promise<void> {
	await writeFile(path.join(fixture.repository_root, name), name)
	await git(fixture.repository_root, ['add', name])
	await git(fixture.repository_root, ['commit', '--no-verify', '-m', name])
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.repository_root = path.join(opened.workspace, REPOSITORY)
	await git(opened.workspace, ['init', MAIN_BRANCH, REPOSITORY])
	await commit_file('base')
	process.chdir(fixture.repository_root)
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('pruning against real Git refs', () => {
	it(
		'keeps a merged branch whose deleted upstream was local',
		async () => {
			await git(fixture.repository_root, ['branch', LOCAL_UPSTREAM])
			await git(fixture.repository_root, ['branch', CANDIDATE])
			await git(fixture.repository_root, ['branch', SET_UPSTREAM, LOCAL_UPSTREAM, CANDIDATE])
			await git(fixture.repository_root, ['branch', '-d', LOCAL_UPSTREAM])

			expect(await gone_branch.prune(DEFAULT_BRANCH)).toEqual({ deleted: [], failed: [] })
			expect(await git(fixture.repository_root, ['branch', '--list', CANDIDATE])).toContain(
				CANDIDATE,
			)
		},
		TIMEOUT_MS,
	)

	it(
		'deletes a merged remote-gone branch when a tag shares the default name',
		async () => {
			await git(fixture.repository_root, ['tag', DEFAULT_BRANCH])
			await commit_file('newer')
			await git(fixture.repository_root, ['branch', CANDIDATE, 'refs/heads/main'])
			await git(fixture.repository_root, [
				'config',
				'remote.origin.fetch',
				'+refs/heads/*:refs/remotes/origin/*',
			])
			await git(fixture.repository_root, ['config', 'branch.candidate.remote', 'origin'])
			await git(fixture.repository_root, ['config', 'branch.candidate.merge', 'refs/heads/deleted'])
			await commit_file('newest')

			expect(await gone_branch.prune(DEFAULT_BRANCH)).toEqual({ deleted: [CANDIDATE], failed: [] })
			expect(await git(fixture.repository_root, ['branch', '--list', CANDIDATE])).toBe('')
		},
		TIMEOUT_MS,
	)
})
