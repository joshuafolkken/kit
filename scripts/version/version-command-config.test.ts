import { describe, expect, it } from 'vitest'
import { create_version_command_config } from './version-command-config'

const KIT = '@joshuafolkken/kit'
const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const KIT_FIX_PATH = 'node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'

describe('create_version_command_config required inputs', () => {
	it('passes through the package name and versions endpoint', () => {
		const config = create_version_command_config({
			package_name: KIT,
			versions_endpoint: KIT_ENDPOINT,
		})

		expect(config.package_name).toBe(KIT)
		expect(config.versions_endpoint).toBe(KIT_ENDPOINT)
	})

	it('derives the fix-gh-packages path from the package name', () => {
		const config = create_version_command_config({
			package_name: KIT,
			versions_endpoint: KIT_ENDPOINT,
		})

		expect(config.fix_gh_packages_path).toBe(KIT_FIX_PATH)
	})

	it('derives the fix-gh-packages path for an arbitrary consumer package', () => {
		const config = create_version_command_config({
			package_name: '@joshuafolkken/game-kit',
			versions_endpoint: '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1',
		})

		expect(config.fix_gh_packages_path).toBe(
			'node_modules/@joshuafolkken/game-kit/scripts/fix-gh-packages.ts',
		)
	})
})

describe('create_version_command_config optional hooks', () => {
	it('omits the optional hooks when they are not supplied', () => {
		const config = create_version_command_config({
			package_name: KIT,
			versions_endpoint: KIT_ENDPOINT,
		})

		expect('self_directory' in config).toBe(false)
		expect('resolve_warning' in config).toBe(false)
	})

	it('retains the optional self_directory and resolve_warning hooks when supplied', () => {
		const warning = '⚠ stale'
		const self_directory = '/pkg/scripts/version'
		const config = create_version_command_config({
			package_name: KIT,
			versions_endpoint: KIT_ENDPOINT,
			self_directory,
			resolve_warning: () => warning,
		})

		expect(config.self_directory).toBe(self_directory)
		expect(config.resolve_warning?.()).toBe(warning)
	})
})
