import { execaSync } from 'execa'
import { vi } from 'vitest'
import type { VersionSnapshot } from './version-check-logic'
import { create_version_command_config, type UpstreamHookContext } from './version-command-config'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

// Shared arrangement for the upstream-chain command tests. Each test file still declares its own
// `vi.mock` calls (vitest hoists those per file and they cannot be shared), but everything built on
// top of the mocks — the package versions, the configs, and the arrangement helper — lives here so
// the report-construction and the command-execution suites cannot drift apart.

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_fetch_latest = vi.mocked(fetch_latest_version)
const mocked_read_global = vi.mocked(version_targets.read_global_version)
const mocked_read_project = vi.mocked(version_targets.read_project_version)

type ExecaSyncResult = ReturnType<typeof execaSync>
type ConfigFor = ReturnType<typeof create_version_command_config>

interface ContextHooks {
	resolve_effective_version: (context: UpstreamHookContext) => string | undefined
	resolve_global_upgrade_command: (context: UpstreamHookContext) => string
}

const MAIN_PACKAGE = '@joshuafolkken/app-kit'
const UPSTREAM_PACKAGE = '@joshuafolkken/kit'
const MAIN_LATEST = '2.0.0'
const UPSTREAM_LATEST = '1.5.0'
const UPSTREAM_STALE = '1.4.0'
const EFFECTIVE_STALE = '1.3.0'
const EFFECTIVE_ADVANCED = '1.4.5'
const UPSTREAM_UPGRADE_COMMAND = `pnpm add -D ${UPSTREAM_PACKAGE}@${UPSTREAM_LATEST}`
// The consumer's global command upgrades the global downstream app-kit (which bundles the effective
// kit) — not a bare `pnpm add -g @joshuafolkken/kit`, which app-kit resolution would shadow.
const GLOBAL_UPGRADE_COMMAND = `pnpm add -g ${MAIN_PACKAGE}@${MAIN_LATEST}`

const CHAINED_CONFIG = create_version_command_config({
	package_name: MAIN_PACKAGE,
	upstreams: [{ package_name: UPSTREAM_PACKAGE }],
})

const CHAINED_CONFIG_WITH_EFFECTIVE = create_version_command_config({
	package_name: MAIN_PACKAGE,
	upstreams: [
		{
			package_name: UPSTREAM_PACKAGE,
			resolve_effective_version: () => EFFECTIVE_STALE,
			resolve_global_upgrade_command: () => GLOBAL_UPGRADE_COMMAND,
		},
	],
})

// Same hooks, plus the consumer's declaration that its global command only pins versions — the
// opt-in that lets kit prove the command dead once that pin is already installed (#697).
const CHAINED_CONFIG_WITH_PINNED_COMMAND = create_version_command_config({
	package_name: MAIN_PACKAGE,
	upstreams: [
		{
			package_name: UPSTREAM_PACKAGE,
			resolve_effective_version: () => EFFECTIVE_STALE,
			resolve_global_upgrade_command: () => GLOBAL_UPGRADE_COMMAND,
			is_global_upgrade_command_pinned: true,
		},
	],
})

// The primary snapshot `read_snapshot` would produce with the main package fully up to date, which
// is also what `arrange_chain_versions` mocks.
const MAIN_SNAPSHOT: VersionSnapshot = {
	global_version: MAIN_LATEST,
	project_version: MAIN_LATEST,
	latest: MAIN_LATEST,
}

function fake_sync_result(exit_code: number | undefined): ExecaSyncResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaSyncResult
}

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

function config_with_context_hooks(hooks: ContextHooks): ConfigFor {
	return create_version_command_config({
		package_name: MAIN_PACKAGE,
		upstreams: [{ package_name: UPSTREAM_PACKAGE, ...hooks }],
	})
}

const version_chain_fixture = {
	arrange_chain_versions,
	config_with_context_hooks,
	fake_sync_result,
}

export {
	CHAINED_CONFIG,
	CHAINED_CONFIG_WITH_EFFECTIVE,
	CHAINED_CONFIG_WITH_PINNED_COMMAND,
	EFFECTIVE_ADVANCED,
	EFFECTIVE_STALE,
	GLOBAL_UPGRADE_COMMAND,
	MAIN_LATEST,
	MAIN_PACKAGE,
	MAIN_SNAPSHOT,
	mocked_execa_sync,
	mocked_fetch_latest,
	UPSTREAM_LATEST,
	UPSTREAM_PACKAGE,
	UPSTREAM_STALE,
	UPSTREAM_UPGRADE_COMMAND,
	version_chain_fixture,
}
