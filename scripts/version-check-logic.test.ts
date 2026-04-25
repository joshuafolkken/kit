import { describe, expect, it } from 'vitest'
import { version_check_logic } from './version-check-logic'

const CURRENT_VERSION = '0.5.0'
const LATEST_VERSION = '0.6.0'
const PACKAGE_NAME = '@joshuafolkken/kit'

describe('version_check_logic.PACKAGE_NAME', () => {
	it('is the joshuafolkken/kit package', () => {
		expect(version_check_logic.PACKAGE_NAME).toBe(PACKAGE_NAME)
	})
})

describe('version_check_logic.format_version_output', () => {
	it('shows up-to-date message when versions match', () => {
		const result = version_check_logic.format_version_output(CURRENT_VERSION, CURRENT_VERSION)

		expect(result).toContain('✓ Up to date')
	})

	it('shows update available message when versions differ', () => {
		const result = version_check_logic.format_version_output(CURRENT_VERSION, LATEST_VERSION)

		expect(result).toContain('⚠ Update available')
		expect(result).toContain(CURRENT_VERSION)
		expect(result).toContain(LATEST_VERSION)
	})

	it('includes run command when update is available', () => {
		const result = version_check_logic.format_version_output(CURRENT_VERSION, LATEST_VERSION)

		expect(result).toContain('Run:')
		expect(result).toContain(LATEST_VERSION)
	})

	it('does not include run command when already up to date', () => {
		const result = version_check_logic.format_version_output(CURRENT_VERSION, CURRENT_VERSION)

		expect(result).not.toContain('Run:')
	})
})

describe('version_check_logic.format_update_command', () => {
	it('returns pnpm add command with package name and version', () => {
		const result = version_check_logic.format_update_command(LATEST_VERSION)

		expect(result).toContain('pnpm add -D')
		expect(result).toContain(PACKAGE_NAME)
		expect(result).toContain(LATEST_VERSION)
	})
})
