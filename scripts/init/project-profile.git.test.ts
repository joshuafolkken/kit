import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execaSync } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import { project_profile } from './project-profile'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
const mocked_execa = vi.mocked(execaSync)
const make_directory = temporary_directory()

function fixture(has_git: boolean): string {
	const root = make_directory('josh-profile-git-')

	if (has_git) mkdirSync(path.join(root, '.git'))

	return root
}

function fake_result(exit_code: number, stdout: string): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

describe('Git and GitHub detection', () => {
	it('does not invoke git or gh in a Git-free directory', () => {
		expect(project_profile.inspect_project(fixture(false))).toMatchObject({
			has_git: false,
			has_github: false,
		})
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('separates local Git from a GitHub origin', () => {
		mocked_execa.mockReturnValue(fake_result(1, ''))
		expect(project_profile.inspect_project(fixture(true)).has_github).toBe(false)
		mocked_execa.mockReturnValue(fake_result(0, 'git@github.com:owner/repo.git'))
		expect(project_profile.inspect_project(fixture(true)).has_github).toBe(true)
	})
})
