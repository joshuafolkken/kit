import { afterEach, describe, expect, it, vi } from 'vitest'
import { git_utilities } from './constants'

const UNIX_GIT_PATH = '/usr/bin/git'
const PLATFORM_WIN32 = 'win32'

vi.mock('node:os', () => ({ platform: vi.fn() }))

const { platform } = await import('node:os')
const mocked_platform = vi.mocked(platform)

afterEach(() => {
	vi.resetAllMocks()
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
})
