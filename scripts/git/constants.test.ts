import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_BINARY_KEY, git_utilities } from './constants'

const UNIX_GIT_PATH = '/usr/bin/git'
const SHIM_PATH = '/guard/git'
const PLATFORM_WIN32 = 'win32'

vi.mock('node:os', () => ({ platform: vi.fn() }))

const { platform } = await import('node:os')
const mocked_platform = vi.mocked(platform)

// The unit suite's own guard names its shim in this variable, so each test starts without it.
beforeEach(() => {
	vi.stubEnv(GIT_BINARY_KEY, '')
})

afterEach(() => {
	vi.resetAllMocks()
	vi.unstubAllEnvs()
})

describe('git_utilities.get_git_command', () => {
	it('returns quoted Windows path on win32', () => {
		mocked_platform.mockReturnValue(PLATFORM_WIN32)

		expect(git_utilities.get_git_command()).toBe(String.raw`"C:\Program Files\Git\cmd\git.exe"`)
	})

	it('returns unix git path on linux', () => {
		mocked_platform.mockReturnValue('linux')

		expect(git_utilities.get_git_command()).toBe(UNIX_GIT_PATH)
	})
})

describe('git_utilities.get_git_command_for_spawn', () => {
	it('returns unquoted Windows path on win32', () => {
		mocked_platform.mockReturnValue(PLATFORM_WIN32)

		expect(git_utilities.get_git_command_for_spawn()).toBe(
			String.raw`C:\Program Files\Git\cmd\git.exe`,
		)
	})

	it('returns unix git path on darwin', () => {
		mocked_platform.mockReturnValue('darwin')

		expect(git_utilities.get_git_command_for_spawn()).toBe(UNIX_GIT_PATH)
	})

	it('returns the binary the environment names, so a guard shim stands in front', () => {
		mocked_platform.mockReturnValue('darwin')
		vi.stubEnv(GIT_BINARY_KEY, SHIM_PATH)

		expect(git_utilities.get_git_command_for_spawn()).toBe(SHIM_PATH)
	})

	it('falls back to the platform path when the environment names an empty binary', () => {
		mocked_platform.mockReturnValue('darwin')
		vi.stubEnv(GIT_BINARY_KEY, '')

		expect(git_utilities.get_git_command_for_spawn()).toBe(UNIX_GIT_PATH)
	})
})
