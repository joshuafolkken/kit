import { describe, expect, it } from 'vitest'
import { version_check_logic } from './version-check-logic'
import { create_version_command_config } from './version-command-config'

const is_local = true
const is_global = false

const KIT_CONFIG = create_version_command_config({
	package_name: '@joshuafolkken/kit',
	versions_endpoint: '/users/joshuafolkken/packages/npm/kit/versions?per_page=1',
})

describe('version_check_logic.format_update_command', () => {
	it('uses -D for a project-local invocation', () => {
		expect(version_check_logic.format_update_command('2.0.0', is_local, KIT_CONFIG)).toBe(
			'pnpm add -D @joshuafolkken/kit@2.0.0',
		)
	})

	it('uses -g for a global invocation', () => {
		expect(version_check_logic.format_update_command('2.0.0', is_global, KIT_CONFIG)).toBe(
			'pnpm add -g @joshuafolkken/kit@2.0.0',
		)
	})
})
