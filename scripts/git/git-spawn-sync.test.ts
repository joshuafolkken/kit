import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_utilities } from './constants'
import { git_command } from './git-command'
import { git_spawn_sync } from './git-spawn-sync'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const ROOT = '/Users/example/project'
const ORIGIN = 'git@github.com:owner/repo.git'
const CUSTOM_TIMEOUT_MS = 2000
const FAILURE_EXIT_CODE = 128

function answer(exit_code: number | undefined, stdout?: string, stderr?: string): void {
	const value: unknown = { exitCode: exit_code, stdout, stderr }

	mocked_execa_sync.mockReturnValue(value as ReturnType<typeof execaSync>)
}

function last_call(): ReadonlyArray<unknown> {
	return mocked_execa_sync.mock.calls.at(-1) ?? []
}

beforeEach(() => {
	mocked_execa_sync.mockReset()
})

describe('git_spawn_sync.run', () => {
	it('spawns the resolved git binary, bounded by the default timeout, without rejecting', () => {
		answer(0, 'out')
		git_spawn_sync.run(['status'])

		expect(last_call()).toStrictEqual([
			git_utilities.get_git_command_for_spawn(),
			['status'],
			{
				extendEnv: true,
				reject: false,
				timeout: git_spawn_sync.GIT_TIMEOUT_MS,
			},
		])
	})

	it('passes the directory, environment and timeout it was given', () => {
		answer(0, '')
		git_spawn_sync.run(['status'], { cwd: ROOT, env: { LC_ALL: 'C' }, timeout: CUSTOM_TIMEOUT_MS })

		expect(last_call()[2]).toMatchObject({
			cwd: ROOT,
			env: { LC_ALL: 'C' },
			timeout: CUSTOM_TIMEOUT_MS,
		})
	})

	it('reads an absent stream as empty and keeps an undefined exit code', () => {
		answer(undefined)

		expect(git_spawn_sync.run(['status'])).toStrictEqual({
			exit_code: undefined,
			stdout: '',
			stderr: '',
		})
	})
})

describe('git_spawn_sync.read', () => {
	it('returns the trimmed output of a successful command', () => {
		answer(0, `${ROOT}\n`)

		expect(git_spawn_sync.read(['rev-parse'])).toBe(ROOT)
	})

	it('returns undefined when the command fails', () => {
		answer(1, 'partial')

		expect(git_spawn_sync.read(['rev-parse'])).toBeUndefined()
	})
})

describe('git_spawn_sync.origin_url', () => {
	it('asks the origin URL in the given directory', () => {
		answer(0, `${ORIGIN}\n`)

		expect(git_spawn_sync.origin_url(ROOT)).toBe(ORIGIN)
		expect(last_call()[1]).toStrictEqual(['config', '--get', 'remote.origin.url'])
		expect(last_call()[2]).toMatchObject({ cwd: ROOT })
	})

	it('is undefined when the repository has no origin', () => {
		answer(1, '')

		expect(git_spawn_sync.origin_url(ROOT)).toBeUndefined()
	})
})

describe('git_spawn_sync.toplevel', () => {
	it('asks the root under the C locale so a caller can match stderr', () => {
		answer(0, `${ROOT}\n`)
		git_spawn_sync.toplevel(CUSTOM_TIMEOUT_MS)

		expect(last_call()[1]).toStrictEqual(['rev-parse', '--show-toplevel'])
		expect(last_call()[2]).toMatchObject({
			env: git_spawn_sync.C_LOCALE,
			timeout: CUSTOM_TIMEOUT_MS,
		})
	})
})

describe('git_command.repository_root', () => {
	it('resolves the trimmed root', async () => {
		answer(0, `${ROOT}\n`)

		await expect(git_command.repository_root()).resolves.toBe(ROOT)
	})

	it('rejects with the exit code when git cannot answer', async () => {
		answer(FAILURE_EXIT_CODE, '', 'fatal: not a git repository')

		await expect(git_command.repository_root()).rejects.toThrow(
			'git rev-parse exited with code 128',
		)
	})
})
