import { describe, expect, it } from 'vitest'
import { version_check_logic } from './version-check-logic'

const is_local = true
const is_global = false

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
