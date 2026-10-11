import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { git_spawn_sync } from './git-spawn-sync'

// joshuafolkken/kit#3684: a git hook exports `GIT_DIR`, which beats `cwd`, so `origin_url(<directory>)`
// answered for the repository the hook fired in. Only real git can show that — a mocked spawn has no
// environment for `GIT_DIR` to win in — so two repositories with different origins stand side by side
// and the environment points at the one that was not asked about.

const WORKSPACE_PREFIX = 'kit-git-spawn-sync-'
const ASKED = 'asked'
const HOOKED = 'hooked'
const ASKED_ORIGIN = 'git@github.com:owner/asked.git'
const HOOKED_ORIGIN = 'git@github.com:owner/hooked.git'
const GIT_DIRECTORY_VARIABLE = 'GIT_DIR'
const GIT_DIRECTORY_NAME = '.git'
const TIMEOUT_MS = 30_000

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace = {
	workspace: '',
	previous_cwd: '',
	restore_environment: undefined,
}

// Written with `git config` rather than `remote add`: the unit suite's network guard refuses `remote`
// outright, and neither origin is ever contacted.
async function init_with_origin(name: string, url: string): Promise<string> {
	const root = path.join(fixture.workspace, name)

	await git(fixture.workspace, ['init', MAIN_BRANCH, name])
	await git(root, ['config', 'remote.origin.url', url])

	return root
}

beforeEach(() => {
	Object.assign(fixture, git_fixture_workspace.open_workspace(WORKSPACE_PREFIX))
})

afterEach(async () => {
	vi.unstubAllEnvs()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('git_spawn_sync.origin_url under a git hook', () => {
	it(
		'answers for the directory it was given while GIT_DIR names another repository',
		async () => {
			const asked = await init_with_origin(ASKED, ASKED_ORIGIN)
			const hooked = await init_with_origin(HOOKED, HOOKED_ORIGIN)

			vi.stubEnv(GIT_DIRECTORY_VARIABLE, path.join(hooked, GIT_DIRECTORY_NAME))

			expect(git_spawn_sync.origin_url(asked)).toBe(ASKED_ORIGIN)
		},
		TIMEOUT_MS,
	)
})
