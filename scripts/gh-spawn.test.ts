import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawnSync: spawn_mock }))

vi.mock('./init-paths', () => ({ PROJECT_ROOT: '/fake/root' }))

const REPO_NAME = 'owner/repo'

const { gh_spawn } = await import('./gh-spawn')

beforeEach(() => {
	spawn_mock.mockReset()
})

describe('gh_spawn.get_repo_name_with_owner — success', () => {
	it('returns trimmed stdout when status is 0 and stdout is non-empty', () => {
		spawn_mock.mockReturnValue({ status: 0, stdout: `  ${REPO_NAME}\n` })

		expect(gh_spawn.get_repo_name_with_owner()).toBe(REPO_NAME)
	})
})

describe('gh_spawn.get_repo_name_with_owner — failure', () => {
	it('returns undefined when status is non-zero', () => {
		spawn_mock.mockReturnValue({ status: 1, stdout: '' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})

	it('returns undefined when stdout is empty', () => {
		spawn_mock.mockReturnValue({ status: 0, stdout: '' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})

	it('returns undefined when stdout is only whitespace', () => {
		spawn_mock.mockReturnValue({ status: 0, stdout: '   ' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})
})
