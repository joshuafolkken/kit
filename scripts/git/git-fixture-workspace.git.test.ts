import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'

const fixture: FixtureWorkspace = {
	previous_cwd: '',
	restore_environment: undefined,
	workspace: '',
}

describe('git_fixture_workspace.git', () => {
	beforeEach(async () => {
		Object.assign(fixture, git_fixture_workspace.open_workspace('kit-fixture-workspace-'))
		await git_fixture_workspace.git(fixture.workspace, ['init', git_fixture_workspace.MAIN_BRANCH])
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('runs every command with auto maintenance off, so no detached writer outlives the workspace', async () => {
		const value = await git_fixture_workspace.git(fixture.workspace, [
			'config',
			'--get',
			'maintenance.auto',
		])

		expect(value).toBe('false')
	})
})
