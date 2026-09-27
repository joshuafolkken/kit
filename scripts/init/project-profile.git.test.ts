import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { project_profile } from './project-profile'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
const mocked_execa = vi.mocked(execaSync)
const roots: Array<string> = []

function fixture(has_git: boolean): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-profile-git-'))

	roots.push(root)
	if (has_git) mkdirSync(path.join(root, '.git'))

	return root
}

function fake_result(exit_code: number, stdout: string): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
	vi.clearAllMocks()
})

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
