import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create_version_command_config } from './version-command-config'
import { version_commands } from './version-commands'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_sync_result(exit_code: number | undefined): ExecaSyncResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaSyncResult
}

const SHADOW_WARNING = '⚠ PATH shadowing'

function config_with(
	overrides: Partial<{ self_directory: string; resolve_warning: () => string | undefined }>,
): ReturnType<typeof create_version_command_config> {
	return create_version_command_config({
		package_name: '@joshuafolkken/kit',
		versions_endpoint: '/users/joshuafolkken/packages/npm/kit/versions?per_page=1',
		...overrides,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('version_commands.run_upgrade_command', () => {
	it('runs the command through sh -c and returns its exit code', () => {
		const upgrade_command = 'npm i -g pkg'

		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(version_commands.run_upgrade_command(upgrade_command)).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledWith('sh', ['-c', upgrade_command], {
			stdio: 'inherit',
			reject: false,
		})
	})

	it('falls back to the failure code when exitCode is undefined', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(version_commands.run_upgrade_command('cmd')).toBe(1)
	})
})

describe('version_commands.run_all_upgrade_commands', () => {
	it('returns 0 and runs no command for an empty list', () => {
		expect(version_commands.run_all_upgrade_commands([])).toBe(0)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('runs every command and returns 0 when all succeed', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(version_commands.run_all_upgrade_commands(['a', 'b'])).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(2)
	})

	it('surfaces a non-zero exit code while still running every command', () => {
		mocked_execa_sync
			.mockReturnValueOnce(fake_sync_result(3))
			.mockReturnValueOnce(fake_sync_result(0))

		expect(version_commands.run_all_upgrade_commands(['a', 'b'])).toBe(3)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(2)
	})
})

describe('version_commands.build_extras', () => {
	it('omits the running binary when no self_dir is configured', () => {
		const extras = version_commands.build_extras(config_with({}))

		expect(extras.running).toBeUndefined()
	})

	it('includes the warning produced by the resolve_warning hook', () => {
		const extras = version_commands.build_extras(
			config_with({ resolve_warning: () => SHADOW_WARNING }),
		)

		expect(extras.warning).toBe(SHADOW_WARNING)
	})

	it('omits the warning when the resolve_warning hook returns undefined', () => {
		const extras = version_commands.build_extras(config_with({ resolve_warning: () => undefined }))

		expect(extras.warning).toBeUndefined()
	})
})
