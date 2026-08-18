import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create_version_command_config } from './version-command-config'
import { version_commands } from './version-commands'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('./version-remote', () => ({
	fetch_latest_version: vi.fn(),
	fetch_release_times: vi.fn(),
}))
vi.mock('./version-targets', () => ({
	version_targets: { read_global_version: vi.fn(), read_project_version: vi.fn() },
}))

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_fetch_latest = vi.mocked(fetch_latest_version)
const mocked_read_global = vi.mocked(version_targets.read_global_version)
const mocked_read_project = vi.mocked(version_targets.read_project_version)

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_sync_result(exit_code: number | undefined): ExecaSyncResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaSyncResult
}

const SHADOW_WARNING = '⚠ PATH shadowing'
const KIT_PACKAGE = '@joshuafolkken/kit'

function config_with(
	overrides: Partial<{ self_directory: string; resolve_warning: () => string | undefined }>,
): ReturnType<typeof create_version_command_config> {
	return create_version_command_config({
		package_name: KIT_PACKAGE,
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

const KIT_STALE = '1.0.0'
const KIT_LATEST = '1.1.0'
// `format_target_status` pads the version to a fixed column before the staleness marker.
const STATUS_PAD_WIDTH = 12
const STATUS_GAP = ' '.repeat(STATUS_PAD_WIDTH - KIT_STALE.length)

// kit declares no upstreams, so neither the no-op guard nor the post-upgrade outcome report may
// touch its output — this pins the whole rendered report, not just a fragment of it.
describe('version_commands.run_check for a package with no upstreams', () => {
	it('renders the unchanged dual report with both upgrade hints', () => {
		mocked_read_global.mockReturnValue(KIT_STALE)
		mocked_read_project.mockReturnValue(KIT_STALE)
		mocked_fetch_latest.mockReturnValue(KIT_LATEST)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		version_commands.run_check(config_with({}))

		expect(String(info_spy.mock.calls[0]?.[0])).toBe(
			[
				KIT_PACKAGE,
				`  Global:  ${KIT_STALE}${STATUS_GAP}⚠ → ${KIT_LATEST}`,
				`  Project:  ${KIT_STALE}${STATUS_GAP}⚠ → ${KIT_LATEST}`,
				`  Latest:  ${KIT_LATEST}`,
				'',
				`Run: pnpm add -g ${KIT_PACKAGE}@${KIT_LATEST}`,
				`Run: pnpm add -D ${KIT_PACKAGE}@${KIT_LATEST} && node_modules/.bin/tsx node_modules/${KIT_PACKAGE}/scripts/fix-gh-packages.ts`,
			].join('\n'),
		)
		info_spy.mockRestore()
	})
})

describe('version_commands.run_upgrade for a package with no upstreams', () => {
	it('runs both scope commands and reports no upstream outcome', () => {
		mocked_read_global.mockReturnValue(KIT_STALE)
		mocked_read_project.mockReturnValue(KIT_STALE)
		mocked_fetch_latest.mockReturnValue(KIT_LATEST)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(version_commands.run_upgrade(config_with({}))).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(2)
		expect(info_spy).not.toHaveBeenCalled()
		info_spy.mockRestore()
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
