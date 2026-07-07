import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create_version_command_config } from './version-command-config'
import { version_commands } from './version-commands'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('./version-remote', () => ({ fetch_latest_version: vi.fn() }))
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

const MAIN_PACKAGE = '@joshuafolkken/app-kit'
const UPSTREAM_PACKAGE = KIT_PACKAGE
const MAIN_LATEST = '2.0.0'
const UPSTREAM_LATEST = '1.5.0'
const UPSTREAM_STALE = '1.4.0'
const UPSTREAM_UPGRADE_COMMAND = `pnpm add -D ${UPSTREAM_PACKAGE}@${UPSTREAM_LATEST}`

const CHAINED_CONFIG = create_version_command_config({
	package_name: MAIN_PACKAGE,
	upstreams: [{ package_name: UPSTREAM_PACKAGE }],
})

// Arrange the mocked reads so the main package is fully up to date and the upstream project
// dependency holds the given version (undefined = not installed).
function arrange_chain_versions(upstream_project: string | undefined): void {
	mocked_read_global.mockReturnValue(MAIN_LATEST)
	mocked_read_project.mockImplementation((_cwd: string, package_name: string) =>
		package_name === UPSTREAM_PACKAGE ? upstream_project : MAIN_LATEST,
	)
	mocked_fetch_latest.mockImplementation((endpoint: string | undefined) =>
		endpoint?.includes('/npm/app-kit/') ? MAIN_LATEST : UPSTREAM_LATEST,
	)
}

describe('version_commands.read_upstream_reports', () => {
	it('reads the project and latest versions for each configured upstream', () => {
		arrange_chain_versions(UPSTREAM_STALE)

		const reports = version_commands.read_upstream_reports(CHAINED_CONFIG)

		expect(reports).toHaveLength(1)
		expect(reports[0]?.config.package_name).toBe(UPSTREAM_PACKAGE)
		expect(reports[0]?.project_version).toBe(UPSTREAM_STALE)
		expect(reports[0]?.latest).toBe(UPSTREAM_LATEST)
	})

	it('returns an empty list when no upstreams are configured', () => {
		const config = create_version_command_config({ package_name: UPSTREAM_PACKAGE })

		expect(version_commands.read_upstream_reports(config)).toStrictEqual([])
	})
})

describe('version_commands.run_check with upstreams', () => {
	it('renders the upstream section and its upgrade hint after the main report', () => {
		arrange_chain_versions(UPSTREAM_STALE)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		version_commands.run_check(CHAINED_CONFIG)
		const output = String(info_spy.mock.calls[0]?.[0])

		expect(output.indexOf(UPSTREAM_PACKAGE)).toBeGreaterThan(output.indexOf(MAIN_PACKAGE))
		expect(output).toContain(`Run: ${UPSTREAM_UPGRADE_COMMAND}`)
		info_spy.mockRestore()
	})
})

describe('version_commands.run_upgrade with upstreams', () => {
	it('runs the project-scope upgrade command for a stale upstream', () => {
		arrange_chain_versions(UPSTREAM_STALE)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(version_commands.run_upgrade(CHAINED_CONFIG)).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_execa_sync).toHaveBeenCalledWith(
			'sh',
			[
				'-c',
				`${UPSTREAM_UPGRADE_COMMAND} && node_modules/.bin/tsx node_modules/${UPSTREAM_PACKAGE}/scripts/fix-gh-packages.ts`,
			],
			{ stdio: 'inherit', reject: false },
		)
	})

	it('reports already up to date when the upstream chain is current', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(version_commands.run_upgrade(CHAINED_CONFIG)).toBe(0)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith('Already up to date')
		info_spy.mockRestore()
	})

	it('skips an upstream that is not installed in the project', () => {
		arrange_chain_versions(undefined)

		expect(version_commands.run_upgrade(CHAINED_CONFIG)).toBe(0)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
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
