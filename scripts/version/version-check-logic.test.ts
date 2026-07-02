import { describe, expect, it } from 'vitest'
import { version_check_logic, type VersionSnapshot } from './version-check-logic'
import { create_version_command_config } from './version-command-config'

const LATEST_VERSION = '0.6.0'
const PACKAGE_NAME = '@joshuafolkken/kit'
const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const PINNED_LATEST = `${PACKAGE_NAME}@${LATEST_VERSION}`
const ADD_LOCAL = 'pnpm add -D'
const ADD_GLOBAL = 'pnpm add -g'
const is_local = true
const is_global = false
const FIX_GH_PACKAGES_MARKER = 'fix-gh-packages'
const GLOBAL = '0.243.0'
const PROJECT = '0.241.0'

const KIT_CONFIG = create_version_command_config({
	package_name: PACKAGE_NAME,
	versions_endpoint: KIT_ENDPOINT,
})

function snapshot(
	global_version: string | undefined,
	project_version: string | undefined,
	latest: string,
): VersionSnapshot {
	return { global_version, project_version, latest }
}

function up_to_date_output(): string {
	return version_check_logic.format_dual_version_output(
		snapshot(LATEST_VERSION, LATEST_VERSION, LATEST_VERSION),
		KIT_CONFIG,
	)
}

describe('version_check_logic.format_update_command', () => {
	it('returns a local pnpm add -D command with package name and version', () => {
		const result = version_check_logic.format_update_command(LATEST_VERSION, is_local, KIT_CONFIG)

		expect(result).toContain(ADD_LOCAL)
		expect(result).toContain(PINNED_LATEST)
	})

	it('returns a global pnpm add -g command for a global invocation', () => {
		const result = version_check_logic.format_update_command(LATEST_VERSION, is_global, KIT_CONFIG)

		expect(result).toContain(ADD_GLOBAL)
		expect(result).toContain(PINNED_LATEST)
	})
})

describe('version_check_logic.build_upgrade_shell_command', () => {
	it('uses -D and runs fix-gh-packages for a project-local upgrade', () => {
		const result = version_check_logic.build_upgrade_shell_command(
			LATEST_VERSION,
			is_local,
			KIT_CONFIG,
		)

		expect(result).toContain(ADD_LOCAL)
		expect(result).toContain(PINNED_LATEST)
		expect(result).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('uses -g and omits fix-gh-packages for a global upgrade', () => {
		const result = version_check_logic.build_upgrade_shell_command(
			LATEST_VERSION,
			is_global,
			KIT_CONFIG,
		)

		expect(result).toContain(ADD_GLOBAL)
		expect(result).toContain(PINNED_LATEST)
		expect(result).not.toContain(FIX_GH_PACKAGES_MARKER)
	})
})

describe('version_check_logic parameterization by package name', () => {
	const OTHER_PACKAGE = '@joshuafolkken/game-kit'
	const OTHER_CONFIG = create_version_command_config({
		package_name: OTHER_PACKAGE,
		versions_endpoint: '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1',
	})

	it('headers the report with the configured package name', () => {
		// An up-to-date snapshot yields no upgrade hints, so the only package name in the output is the
		// configured one — kit would otherwise appear via the shared fix-gh-packages repair path.
		const result = version_check_logic.format_dual_version_output(
			snapshot(LATEST_VERSION, LATEST_VERSION, LATEST_VERSION),
			OTHER_CONFIG,
		)

		expect(result).toContain(OTHER_PACKAGE)
		expect(result).not.toContain(PACKAGE_NAME)
	})

	it('builds upgrade commands for the configured package name', () => {
		const result = version_check_logic.format_update_command(LATEST_VERSION, is_local, OTHER_CONFIG)

		expect(result).toContain(`${OTHER_PACKAGE}@${LATEST_VERSION}`)
	})

	// Regression: a non-kit package (game-kit/app-kit) must repair with kit's single published
	// fix-gh-packages.ts, since those packages never ship their own — pointing at the target
	// package's path caused ERR_MODULE_NOT_FOUND during `jgame vu`.
	it('points the fix-gh-packages repair at kit for a non-kit package', () => {
		const result = version_check_logic.build_upgrade_shell_command(
			LATEST_VERSION,
			is_local,
			OTHER_CONFIG,
		)

		expect(result).toContain(`node_modules/${PACKAGE_NAME}/scripts/fix-gh-packages.ts`)
		expect(result).not.toContain(`node_modules/${OTHER_PACKAGE}/scripts/fix-gh-packages.ts`)
	})
})

describe('version_check_logic.format_dual_version_output display', () => {
	it('lists global, project, and latest versions', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(GLOBAL, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toContain('Global:')
		expect(result).toContain('Project:')
		expect(result).toContain('Latest:')
		expect(result).toContain(GLOBAL)
		expect(result).toContain(PROJECT)
		expect(result).toContain(LATEST_VERSION)
	})

	it('aligns the three labels with consistent spacing after the colon', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(GLOBAL, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toContain('Global:  ')
		expect(result).toContain('Project:  ')
		expect(result).toContain('Latest:  ')
	})

	it('marks an up-to-date target with a check and omits its run hint', () => {
		const result = up_to_date_output()

		expect(result).toContain('✓')
		expect(result).not.toContain('Run:')
	})

	it('shows "not installed" for a missing target', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(undefined, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toContain('not installed')
	})
})

describe('version_check_logic.format_dual_version_output run hints', () => {
	it('emits a global run hint when only the global install is stale', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(GLOBAL, LATEST_VERSION, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toContain('Run:')
		expect(result).toContain(ADD_GLOBAL)
		expect(result).not.toContain(ADD_LOCAL)
	})

	it('emits a project run hint when only the project install is stale', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(LATEST_VERSION, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toContain(ADD_LOCAL)
		expect(result).not.toContain(ADD_GLOBAL)
	})

	it('skips the hint for a target that is not installed', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(undefined, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).not.toContain(ADD_GLOBAL)
		expect(result).toContain(ADD_LOCAL)
	})
})

const RUNNING_VERSION = '0.247.0'
const RUNNING_PATH = '/Users/me/Library/pnpm/global/5/node_modules/@joshuafolkken/kit'
const SHADOW_WARNING = '⚠ PATH shadowing: the josh on PATH is stale'

describe('version_check_logic.format_running_line', () => {
	it('renders the running binary version and path', () => {
		const lines = version_check_logic.format_running_line({
			version: RUNNING_VERSION,
			path: RUNNING_PATH,
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain('Running:')
		expect(lines[0]).toContain(RUNNING_VERSION)
		expect(lines[0]).toContain(RUNNING_PATH)
	})

	it('renders nothing when the running binary is unknown', () => {
		expect(version_check_logic.format_running_line(undefined)).toStrictEqual([])
	})
})

describe('version_check_logic.format_dual_version_output running binary', () => {
	it('includes a Running line reporting the binary that actually executed', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(GLOBAL, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
			{ running: { version: RUNNING_VERSION, path: RUNNING_PATH } },
		)

		expect(result).toContain('Running:')
		expect(result).toContain(RUNNING_PATH)
	})

	it('omits the Running line when the running binary is unknown', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(GLOBAL, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).not.toContain('Running:')
	})

	it('appends a shadowing warning when one is provided', () => {
		const result = version_check_logic.format_dual_version_output(
			snapshot(LATEST_VERSION, LATEST_VERSION, LATEST_VERSION),
			KIT_CONFIG,
			{ running: { version: RUNNING_VERSION, path: RUNNING_PATH }, warning: SHADOW_WARNING },
		)

		expect(result).toContain(SHADOW_WARNING)
	})

	it('omits the warning block when no warning is provided', () => {
		const result = up_to_date_output()

		expect(result).not.toContain('PATH shadowing')
	})
})

describe('version_check_logic.format_dual_version_output upstream default', () => {
	it('produces the exact no-upstream output when the chain is empty', () => {
		const with_empty_chain = version_check_logic.format_dual_version_output(
			snapshot(GLOBAL, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
			{},
			[],
		)

		expect(with_empty_chain).toBe(
			version_check_logic.format_dual_version_output(
				snapshot(GLOBAL, PROJECT, LATEST_VERSION),
				KIT_CONFIG,
			),
		)
	})
})

describe('version_check_logic.build_dual_upgrade_commands', () => {
	it('builds both commands when both targets are stale', () => {
		const result = version_check_logic.build_dual_upgrade_commands(
			snapshot(GLOBAL, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toHaveLength(2)
		expect(result[0]).toContain(ADD_GLOBAL)
		expect(result[1]).toContain(ADD_LOCAL)
		expect(result[1]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('returns an empty list when both targets are up to date', () => {
		const result = version_check_logic.build_dual_upgrade_commands(
			snapshot(LATEST_VERSION, LATEST_VERSION, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toStrictEqual([])
	})

	it('skips a target that is not installed', () => {
		const result = version_check_logic.build_dual_upgrade_commands(
			snapshot(undefined, PROJECT, LATEST_VERSION),
			KIT_CONFIG,
		)

		expect(result).toHaveLength(1)
		expect(result[0]).toContain(ADD_LOCAL)
	})
})
