import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))

vi.mock('./init/init-paths', () => ({ PROJECT_ROOT: '/fake/root' }))

const REPO_NAME = 'owner/repo'

const { gh_spawn } = await import('./gh-spawn')

beforeEach(() => {
	execa_sync_mock.mockReset()
})

describe('gh_spawn.get_repo_name_with_owner — success', () => {
	it('returns trimmed stdout when exitCode is 0 and stdout is non-empty', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: `  ${REPO_NAME}\n` })

		expect(gh_spawn.get_repo_name_with_owner()).toBe(REPO_NAME)
	})
})

describe('gh_spawn.get_repo_name_with_owner — failure', () => {
	it('returns undefined when exitCode is non-zero', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 1, stdout: '' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})

	it('returns undefined when stdout is empty', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: '' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})

	it('returns undefined when stdout is only whitespace', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: ' '.repeat(3) })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})
})
