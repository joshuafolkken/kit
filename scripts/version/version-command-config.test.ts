import { describe, expect, it } from 'vitest'
import { create_version_command_config, derive_versions_endpoint } from './version-command-config'

const KIT = '@joshuafolkken/kit'
const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const KIT_FIX_PATH = 'node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'
const APP_KIT = '@joshuafolkken/app-kit'
const APP_KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/app-kit/versions?per_page=1'
const GAME_KIT = '@joshuafolkken/game-kit'

describe('derive_versions_endpoint', () => {
	it('derives the GitHub Packages endpoint from a scoped package name', () => {
		expect(derive_versions_endpoint(KIT)).toBe(KIT_ENDPOINT)
	})

	it('uses the scope as the owner for any consumer package', () => {
		expect(derive_versions_endpoint(APP_KIT)).toBe(APP_KIT_ENDPOINT)
	})

	it('throws for an unscoped package name', () => {
		expect(() => derive_versions_endpoint('lodash')).toThrow('unscoped package name')
	})
})

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
			package_name: GAME_KIT,
			versions_endpoint: '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1',
		})

		expect(config.fix_gh_packages_path).toBe(
			'node_modules/@joshuafolkken/game-kit/scripts/fix-gh-packages.ts',
		)
	})
})

describe('create_version_command_config derived endpoint', () => {
	it('derives the versions endpoint when none is supplied', () => {
		const config = create_version_command_config({ package_name: KIT })

		expect(config.versions_endpoint).toBe(KIT_ENDPOINT)
	})

	it('prefers an explicitly supplied versions endpoint', () => {
		const override_endpoint = '/custom/endpoint'
		const config = create_version_command_config({
			package_name: KIT,
			versions_endpoint: override_endpoint,
		})

		expect(config.versions_endpoint).toBe(override_endpoint)
	})
})

describe('create_version_command_config upstreams', () => {
	it('defaults to an empty upstream chain', () => {
		const config = create_version_command_config({ package_name: KIT })

		expect(config.upstreams).toStrictEqual([])
	})

	it('resolves each upstream descriptor into a full per-package config', () => {
		const config = create_version_command_config({
			package_name: GAME_KIT,
			upstreams: [{ package_name: APP_KIT }, { package_name: KIT }],
		})

		expect(config.upstreams).toStrictEqual([
			{
				package_name: APP_KIT,
				versions_endpoint: APP_KIT_ENDPOINT,
				fix_gh_packages_path: 'node_modules/@joshuafolkken/app-kit/scripts/fix-gh-packages.ts',
			},
			{
				package_name: KIT,
				versions_endpoint: KIT_ENDPOINT,
				fix_gh_packages_path: KIT_FIX_PATH,
			},
		])
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
