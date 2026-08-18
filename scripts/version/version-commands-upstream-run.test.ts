import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CHAINED_CONFIG,
	CHAINED_CONFIG_WITH_EFFECTIVE,
	CHAINED_CONFIG_WITH_PINNED_COMMAND,
	EFFECTIVE_ADVANCED,
	EFFECTIVE_STALE,
	GLOBAL_UPGRADE_COMMAND,
	MAIN_LATEST,
	MAIN_PACKAGE,
	mocked_execa_sync,
	mocked_fetch_latest,
	UPSTREAM_LATEST,
	UPSTREAM_PACKAGE,
	UPSTREAM_STALE,
	UPSTREAM_UPGRADE_COMMAND,
	version_chain_fixture,
} from './version-chain-fixture'
import type { UpstreamHookContext } from './version-command-config'
import { version_commands } from './version-commands'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('./version-remote', () => ({
	fetch_latest_version: vi.fn(),
	fetch_release_times: vi.fn(),
}))
vi.mock('./version-targets', () => ({
	version_targets: { read_global_version: vi.fn(), read_project_version: vi.fn() },
}))

const { arrange_chain_versions, config_with_context_hooks, fake_sync_result } =
	version_chain_fixture

beforeEach(() => {
	vi.clearAllMocks()
})

describe('version_commands.run_check threads the fetched latest without re-fetching', () => {
	it('feeds read_snapshot latest into the hook and fetches latest only once per package', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const config = config_with_context_hooks({
			resolve_effective_version: () => EFFECTIVE_STALE,
			resolve_global_upgrade_command: (context) => `pnpm add -g ${MAIN_PACKAGE}@${context.latest}`,
		})

		version_commands.run_check(config)

		// Two fetches only (main + upstream); the hook reuses the threaded latest, no third fetch.
		expect(mocked_fetch_latest).toHaveBeenCalledTimes(2)
		expect(String(info_spy.mock.calls[0]?.[0])).toContain(
			`pnpm add -g ${MAIN_PACKAGE}@${MAIN_LATEST}`,
		)
		info_spy.mockRestore()
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

describe('version_commands.run_upgrade with a stale effective upstream', () => {
	it('runs the consumer global command when only the effective upstream is stale', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(version_commands.run_upgrade(CHAINED_CONFIG_WITH_EFFECTIVE)).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_execa_sync).toHaveBeenCalledWith('sh', ['-c', GLOBAL_UPGRADE_COMMAND], {
			stdio: 'inherit',
			reject: false,
		})
	})
})

describe('version_commands.run_check with a stale effective upstream', () => {
	it('renders the effective Global line and its upgrade hint', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		version_commands.run_check(CHAINED_CONFIG_WITH_EFFECTIVE)
		const output = String(info_spy.mock.calls[0]?.[0])

		expect(output).toContain(`Global:  ${EFFECTIVE_STALE}`)
		expect(output).toContain(`Run: ${GLOBAL_UPGRADE_COMMAND}`)
		info_spy.mockRestore()
	})
})

describe('version_commands.run_check with a dead global upgrade command', () => {
	it('replaces the Run hint with the explanation when the command is already satisfied', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		version_commands.run_check(CHAINED_CONFIG_WITH_PINNED_COMMAND)
		const output = String(info_spy.mock.calls[0]?.[0])

		expect(output).toContain(`Global:  ${EFFECTIVE_STALE}`)
		expect(output).not.toContain('Run:')
		expect(output).toContain(`Note: \`${GLOBAL_UPGRADE_COMMAND}\``)
		info_spy.mockRestore()
	})
})

describe('version_commands.run_upgrade with a dead global upgrade command', () => {
	it('runs nothing and explains why instead of reporting everything as current', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(version_commands.run_upgrade(CHAINED_CONFIG_WITH_PINNED_COMMAND)).toBe(0)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
		expect(String(info_spy.mock.calls[0]?.[0])).toContain(GLOBAL_UPGRADE_COMMAND)
		info_spy.mockRestore()
	})
})

describe('version_commands.run_upgrade outcome for a suppressed global command', () => {
	it('does not blame a global command the user was never offered', () => {
		arrange_chain_versions(UPSTREAM_STALE)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		// The project dependency is stale, so an upgrade does run — but the effective global command
		// was suppressed as a no-op and must not be reported as having failed to change anything.
		expect(version_commands.run_upgrade(CHAINED_CONFIG_WITH_PINNED_COMMAND)).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(info_spy).not.toHaveBeenCalled()
		info_spy.mockRestore()
	})
})

describe('version_commands.run_upgrade effective outcome', () => {
	it('reports an advance that still trails latest rather than staying silent', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const config = config_with_context_hooks({
			resolve_effective_version: vi
				.fn<(context: UpstreamHookContext) => string | undefined>()
				.mockReturnValueOnce(EFFECTIVE_STALE)
				.mockReturnValue(EFFECTIVE_ADVANCED),
			resolve_global_upgrade_command: () => GLOBAL_UPGRADE_COMMAND,
		})

		expect(version_commands.run_upgrade(config)).toBe(0)
		expect(String(info_spy.mock.calls[0]?.[0])).toContain(
			`${EFFECTIVE_STALE} → ${EFFECTIVE_ADVANCED}`,
		)
		info_spy.mockRestore()
	})
})
