import { describe, expect, it } from 'vitest'
import { version_check_logic } from './version-check-logic'

const CURRENT_VERSION = '0.5.0'
const LATEST_VERSION = '0.6.0'
const PACKAGE_NAME = '@joshuafolkken/kit'
const PINNED_LATEST = `${PACKAGE_NAME}@${LATEST_VERSION}`
const ADD_LOCAL = 'pnpm add -D'
const ADD_GLOBAL = 'pnpm add -g'
const is_local = true
const is_global = false
const FIX_GH_PACKAGES_MARKER = 'fix-gh-packages'

function version_output(current: string, latest: string): string {
	return version_check_logic.format_version_output(current, latest, is_local)
}

describe('version_check_logic.PACKAGE_NAME', () => {
	it('is the joshuafolkken/kit package', () => {
		expect(version_check_logic.PACKAGE_NAME).toBe(PACKAGE_NAME)
	})
})

describe('version_check_logic.format_version_output', () => {
	it('shows up-to-date message when versions match', () => {
		expect(version_output(CURRENT_VERSION, CURRENT_VERSION)).toContain('✓ Up to date')
	})

	it('shows update available message when versions differ', () => {
		const result = version_output(CURRENT_VERSION, LATEST_VERSION)

		expect(result).toContain('⚠ Update available')
		expect(result).toContain(CURRENT_VERSION)
		expect(result).toContain(LATEST_VERSION)
	})

	it('includes run command when update is available', () => {
		const result = version_output(CURRENT_VERSION, LATEST_VERSION)

		expect(result).toContain('Run:')
		expect(result).toContain(LATEST_VERSION)
	})

	it('does not include run command when already up to date', () => {
		expect(version_output(CURRENT_VERSION, CURRENT_VERSION)).not.toContain('Run:')
	})
})

describe('version_check_logic.format_update_command', () => {
	it('returns a local pnpm add -D command with package name and version', () => {
		const result = version_check_logic.format_update_command(LATEST_VERSION, is_local)

		expect(result).toContain(ADD_LOCAL)
		expect(result).toContain(PINNED_LATEST)
	})

	it('returns a global pnpm add -g command for a global invocation', () => {
		const result = version_check_logic.format_update_command(LATEST_VERSION, is_global)

		expect(result).toContain(ADD_GLOBAL)
		expect(result).toContain(PINNED_LATEST)
	})
})

describe('version_check_logic.is_local_install', () => {
	const CWD = '/project'

	it('is local when the running binary lives under cwd/node_modules', () => {
		const self_directory = '/project/node_modules/@joshuafolkken/kit/dist'

		expect(version_check_logic.is_local_install(CWD, self_directory)).toBe(true)
	})

	it('is local when the running binary is a nested .pnpm store path under cwd', () => {
		const self_directory =
			'/project/node_modules/.pnpm/@joshuafolkken+kit@0.6.0/node_modules/@joshuafolkken/kit/dist'

		expect(version_check_logic.is_local_install(CWD, self_directory)).toBe(true)
	})

	it('is global when the running binary lives in the global pnpm store', () => {
		const self_directory =
			'/home/user/.local/share/pnpm/global/5/node_modules/@joshuafolkken/kit/dist'

		expect(version_check_logic.is_local_install(CWD, self_directory)).toBe(false)
	})

	it('is global when the path only shares a sibling prefix with cwd/node_modules', () => {
		const self_directory = '/project/node_modules-other/@joshuafolkken/kit/dist'

		expect(version_check_logic.is_local_install(CWD, self_directory)).toBe(false)
	})
})

describe('version_check_logic.build_upgrade_shell_command', () => {
	it('uses -D and runs fix-gh-packages for a project-local upgrade', () => {
		const result = version_check_logic.build_upgrade_shell_command(LATEST_VERSION, is_local)

		expect(result).toContain(ADD_LOCAL)
		expect(result).toContain(PINNED_LATEST)
		expect(result).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('uses -g and omits fix-gh-packages for a global upgrade', () => {
		const result = version_check_logic.build_upgrade_shell_command(LATEST_VERSION, is_global)

		expect(result).toContain(ADD_GLOBAL)
		expect(result).toContain(PINNED_LATEST)
		expect(result).not.toContain(FIX_GH_PACKAGES_MARKER)
	})
})

describe('version_check_logic.resolve_package_path', () => {
	it('reports the running binary own package.json', () => {
		const result = version_check_logic.resolve_package_path(
			'/global/store/@joshuafolkken/kit/scripts/version',
		)

		expect(result).toBe('/global/store/@joshuafolkken/kit/package.json')
	})
})
