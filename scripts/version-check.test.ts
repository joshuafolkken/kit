import { describe, expect, it } from 'vitest'
import { version_check_logic } from './version-check-logic'

const CURRENT_VERSION = '1.0.0'
const LATEST_VERSION = '1.2.3'
const SHOWS_CURRENT_VERSION = 'shows current version'
const SHOWS_LATEST_VERSION = 'shows latest version'

describe('version_check_logic.format_version_output — up to date', () => {
	const output = version_check_logic.format_version_output(LATEST_VERSION, LATEST_VERSION)

	it(SHOWS_CURRENT_VERSION, () => {
		expect(output).toContain(`Current: ${LATEST_VERSION}`)
	})

	it(SHOWS_LATEST_VERSION, () => {
		expect(output).toContain(`Latest:  ${LATEST_VERSION}`)
	})

	it('shows up-to-date status', () => {
		expect(output).toContain('✓ Up to date')
	})

	it('does not show update command when already at latest', () => {
		expect(output).not.toContain('pnpm add')
	})
})

describe('version_check_logic.format_version_output — update available', () => {
	const output = version_check_logic.format_version_output(CURRENT_VERSION, LATEST_VERSION)

	it(SHOWS_CURRENT_VERSION, () => {
		expect(output).toContain(`Current: ${CURRENT_VERSION}`)
	})

	it(SHOWS_LATEST_VERSION, () => {
		expect(output).toContain(`Latest:  ${LATEST_VERSION}`)
	})

	it('shows update available status with version arrow', () => {
		expect(output).toContain(`⚠ Update available: ${CURRENT_VERSION} → ${LATEST_VERSION}`)
	})

	it('shows pnpm add command with latest version', () => {
		expect(output).toContain(`pnpm add -D @joshuafolkken/kit@${LATEST_VERSION}`)
	})
})

describe('version_check_logic.format_update_command', () => {
	it('includes the package name with version pinned', () => {
		expect(version_check_logic.format_update_command('2.0.0')).toBe(
			'pnpm add -D @joshuafolkken/kit@2.0.0',
		)
	})
})

describe('version_check_logic.PACKAGE_NAME', () => {
	it('is the scoped npm package name', () => {
		expect(version_check_logic.PACKAGE_NAME).toBe('@joshuafolkken/kit')
	})
})

describe('version_check_logic.resolve_package_path', () => {
	const CWD = '/project'
	const SELF_DIRECTORY = '/global/store/@joshuafolkken/kit/scripts'

	it('prefers the consumer project node_modules copy when it exists', () => {
		const result = version_check_logic.resolve_package_path(CWD, SELF_DIRECTORY, () => true)

		expect(result).toBe('/project/node_modules/@joshuafolkken/kit/package.json')
	})

	it('falls back to the running script package.json when no local copy exists', () => {
		// Regression: a global `josh v` run outside a consumer project crashed with
		// ENOENT because it only looked in cwd/node_modules.
		const result = version_check_logic.resolve_package_path(CWD, SELF_DIRECTORY, () => false)

		expect(result).toBe('/global/store/@joshuafolkken/kit/package.json')
	})
})
