import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CHAINED_CONFIG,
	CHAINED_CONFIG_WITH_EFFECTIVE,
	CHAINED_CONFIG_WITH_PINNED_COMMAND,
	EFFECTIVE_STALE,
	GLOBAL_UPGRADE_COMMAND,
	MAIN_LATEST,
	MAIN_PACKAGE,
	MAIN_SNAPSHOT,
	UPSTREAM_LATEST,
	UPSTREAM_PACKAGE,
	UPSTREAM_STALE,
	version_chain_fixture,
} from './version-chain-fixture'
import { create_version_command_config, type UpstreamHookContext } from './version-command-config'
import { version_commands } from './version-commands'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('./version-remote', () => ({
	fetch_latest_version: vi.fn(),
	fetch_release_times: vi.fn(),
}))
vi.mock('./version-targets', () => ({
	version_targets: { read_global_version: vi.fn(), read_project_version: vi.fn() },
}))

const { arrange_chain_versions, config_with_context_hooks } = version_chain_fixture

beforeEach(() => {
	vi.clearAllMocks()
})

describe('version_commands.read_upstream_reports', () => {
	it('reads the project and latest versions for each configured upstream', () => {
		arrange_chain_versions(UPSTREAM_STALE)

		const reports = version_commands.read_upstream_reports(CHAINED_CONFIG, MAIN_SNAPSHOT)

		expect(reports).toHaveLength(1)
		expect(reports[0]?.config.package_name).toBe(UPSTREAM_PACKAGE)
		expect(reports[0]?.project_version).toBe(UPSTREAM_STALE)
		expect(reports[0]?.latest).toBe(UPSTREAM_LATEST)
	})

	it('returns an empty list when no upstreams are configured', () => {
		const config = create_version_command_config({ package_name: UPSTREAM_PACKAGE })

		expect(version_commands.read_upstream_reports(config, MAIN_SNAPSHOT)).toStrictEqual([])
	})

	it('populates the effective install from the consumer hooks when supplied', () => {
		arrange_chain_versions(UPSTREAM_LATEST)

		const reports = version_commands.read_upstream_reports(
			CHAINED_CONFIG_WITH_EFFECTIVE,
			MAIN_SNAPSHOT,
		)

		expect(reports[0]?.effective).toStrictEqual({
			version: EFFECTIVE_STALE,
			upgrade_command: GLOBAL_UPGRADE_COMMAND,
		})
	})

	it('omits the effective install when the upstream declares no hooks', () => {
		arrange_chain_versions(UPSTREAM_LATEST)

		const reports = version_commands.read_upstream_reports(CHAINED_CONFIG, MAIN_SNAPSHOT)

		expect(reports[0]?.effective).toBeUndefined()
	})
})

describe('version_commands.read_upstream_reports installed versions', () => {
	it('carries the installed versions only when the command is declared pin-only', () => {
		arrange_chain_versions(UPSTREAM_LATEST)

		const reports = version_commands.read_upstream_reports(
			CHAINED_CONFIG_WITH_PINNED_COMMAND,
			MAIN_SNAPSHOT,
		)

		expect(reports[0]?.installed_versions?.get(MAIN_PACKAGE)).toBe(MAIN_LATEST)
		expect(reports[0]?.installed_versions?.get(UPSTREAM_PACKAGE)).toBe(EFFECTIVE_STALE)
	})

	it('omits the installed versions when the consumer made no pin-only declaration', () => {
		arrange_chain_versions(UPSTREAM_LATEST)

		const reports = version_commands.read_upstream_reports(
			CHAINED_CONFIG_WITH_EFFECTIVE,
			MAIN_SNAPSHOT,
		)

		expect(reports[0]?.installed_versions).toBeUndefined()
	})
})

const EXPECTED_HOOK_CONTEXT = { latest: MAIN_LATEST, upstream_latest: UPSTREAM_LATEST }

describe('version_commands.read_upstream_reports hook context', () => {
	it('passes both already-fetched latests to the effective-install hooks', () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const effective_spy = vi.fn(() => EFFECTIVE_STALE)
		const upgrade_spy = vi.fn(
			(context: UpstreamHookContext) => `pnpm add -g ${MAIN_PACKAGE}@${context.latest}`,
		)
		const config = config_with_context_hooks({
			resolve_effective_version: effective_spy,
			resolve_global_upgrade_command: upgrade_spy,
		})

		const reports = version_commands.read_upstream_reports(config, MAIN_SNAPSHOT)

		expect(effective_spy).toHaveBeenCalledWith(EXPECTED_HOOK_CONTEXT)
		expect(upgrade_spy).toHaveBeenCalledWith(EXPECTED_HOOK_CONTEXT)
		expect(reports[0]?.effective?.upgrade_command).toBe(
			`pnpm add -g ${MAIN_PACKAGE}@${MAIN_LATEST}`,
		)
	})

	it("lets a hook pin the upstream's own latest, distinct from the downstream latest", () => {
		arrange_chain_versions(UPSTREAM_LATEST)
		const config = config_with_context_hooks({
			resolve_effective_version: () => EFFECTIVE_STALE,
			resolve_global_upgrade_command: (context) =>
				`pnpm add -g ${UPSTREAM_PACKAGE}@${context.upstream_latest}`,
		})

		const reports = version_commands.read_upstream_reports(config, MAIN_SNAPSHOT)

		expect(reports[0]?.effective?.upgrade_command).toBe(
			`pnpm add -g ${UPSTREAM_PACKAGE}@${UPSTREAM_LATEST}`,
		)
	})
})
