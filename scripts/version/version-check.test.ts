import { describe, expect, it } from 'vitest'
import { version_check_logic } from './version-check-logic'

const CURRENT_VERSION = '1.0.0'
const LATEST_VERSION = '1.2.3'
const SHOWS_CURRENT_VERSION = 'shows current version'
const SHOWS_LATEST_VERSION = 'shows latest version'
const is_local = true
const is_global = false

describe('version_check_logic.format_version_output — up to date', () => {
	const output = version_check_logic.format_version_output(LATEST_VERSION, LATEST_VERSION, is_local)

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
	const output = version_check_logic.format_version_output(
		CURRENT_VERSION,
		LATEST_VERSION,
		is_local,
	)

	it(SHOWS_CURRENT_VERSION, () => {
		expect(output).toContain(`Current: ${CURRENT_VERSION}`)
	})

	it(SHOWS_LATEST_VERSION, () => {
		expect(output).toContain(`Latest:  ${LATEST_VERSION}`)
	})

	it('shows update available status with version arrow', () => {
		expect(output).toContain(`⚠ Update available: ${CURRENT_VERSION} → ${LATEST_VERSION}`)
	})

	it('shows local pnpm add -D command for a project-local invocation', () => {
		expect(output).toContain(`pnpm add -D @joshuafolkken/kit@${LATEST_VERSION}`)
	})

	it('shows global pnpm add -g command for a global invocation', () => {
		const global_output = version_check_logic.format_version_output(
			CURRENT_VERSION,
			LATEST_VERSION,
			is_global,
		)

		expect(global_output).toContain(`pnpm add -g @joshuafolkken/kit@${LATEST_VERSION}`)
	})
})

describe('version_check_logic.format_update_command', () => {
	it('uses -D for a project-local invocation', () => {
		expect(version_check_logic.format_update_command('2.0.0', is_local)).toBe(
			'pnpm add -D @joshuafolkken/kit@2.0.0',
		)
	})

	it('uses -g for a global invocation', () => {
		expect(version_check_logic.format_update_command('2.0.0', is_global)).toBe(
			'pnpm add -g @joshuafolkken/kit@2.0.0',
		)
	})
})

describe('version_check_logic.PACKAGE_NAME', () => {
	it('is the scoped npm package name', () => {
		expect(version_check_logic.PACKAGE_NAME).toBe('@joshuafolkken/kit')
	})
})

describe('version_check_logic.resolve_package_path', () => {
	it('reports the running binary own package.json regardless of cwd', () => {
		const result = version_check_logic.resolve_package_path(
			'/global/store/@joshuafolkken/kit/scripts/version',
		)

		expect(result).toBe('/global/store/@joshuafolkken/kit/package.json')
	})

	it('resolves a project-local running binary to its own package.json', () => {
		const self_directory = '/project/node_modules/@joshuafolkken/kit/scripts/version'
		const result = version_check_logic.resolve_package_path(self_directory)

		expect(result).toBe('/project/node_modules/@joshuafolkken/kit/package.json')
	})
})
