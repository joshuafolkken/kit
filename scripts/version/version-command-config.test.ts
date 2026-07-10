import { describe, expect, it } from 'vitest'
import { create_version_command_config, derive_versions_endpoint } from './version-command-config'

const KIT = '@joshuafolkken/kit'
const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const KIT_FIX_PATH = 'node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'
const APP_KIT = '@joshuafolkken/app-kit'
const APP_KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/app-kit/versions?per_page=1'
const GAME_KIT = '@joshuafolkken/game-kit'
const HOOK_CONTEXT = { latest: '2.0.0' }
const BLANK_SPACES = 3

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

	it('points the fix-gh-packages path at kit for a non-kit consumer package', () => {
		const config = create_version_command_config({
			package_name: GAME_KIT,
			versions_endpoint: '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1',
		})

		expect(config.fix_gh_packages_path).toBe(KIT_FIX_PATH)
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

	it('throws an actionable error when an empty versions endpoint is supplied', () => {
		expect(() =>
			create_version_command_config({ package_name: KIT, versions_endpoint: '' }),
		).toThrow(/versions_endpoint for @joshuafolkken\/kit was set to an empty string/u)
	})

	it('throws for a whitespace-only versions endpoint instead of letting it reach the fetch layer', () => {
		const blank_spaces = ' '.repeat(BLANK_SPACES)

		expect(() =>
			create_version_command_config({ package_name: GAME_KIT, versions_endpoint: blank_spaces }),
		).toThrow(/versions_endpoint for @joshuafolkken\/game-kit was set to an empty string/u)
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
				fix_gh_packages_path: KIT_FIX_PATH,
			},
			{
				package_name: KIT,
				versions_endpoint: KIT_ENDPOINT,
				fix_gh_packages_path: KIT_FIX_PATH,
			},
		])
	})
})

describe('create_version_command_config upstream effective hooks', () => {
	it('omits the effective-install hooks when the upstream descriptor supplies none', () => {
		const config = create_version_command_config({
			package_name: APP_KIT,
			upstreams: [{ package_name: KIT }],
		})
		const [upstream] = config.upstreams

		expect('resolve_effective_version' in (upstream ?? {})).toBe(false)
		expect('resolve_global_upgrade_command' in (upstream ?? {})).toBe(false)
	})

	it('carries through the effective-install hooks when the upstream descriptor supplies them', () => {
		const effective_version = '1.5.0'
		const global_upgrade_command = 'pnpm add -g @joshuafolkken/app-kit@0.32.0'
		const config = create_version_command_config({
			package_name: APP_KIT,
			upstreams: [
				{
					package_name: KIT,
					resolve_effective_version: () => effective_version,
					resolve_global_upgrade_command: () => global_upgrade_command,
				},
			],
		})
		const [upstream] = config.upstreams

		expect(upstream?.resolve_effective_version?.(HOOK_CONTEXT)).toBe(effective_version)
		expect(upstream?.resolve_global_upgrade_command?.(HOOK_CONTEXT)).toBe(global_upgrade_command)
	})
})

describe('create_version_command_config upstream hook context', () => {
	it('lets a hook build its global upgrade command from the context latest', () => {
		const config = create_version_command_config({
			package_name: APP_KIT,
			upstreams: [
				{
					package_name: KIT,
					resolve_effective_version: () => '1.5.0',
					resolve_global_upgrade_command: (context) => `pnpm add -g ${APP_KIT}@${context.latest}`,
				},
			],
		})
		const [upstream] = config.upstreams

		expect(upstream?.resolve_global_upgrade_command?.(HOOK_CONTEXT)).toBe(
			`pnpm add -g ${APP_KIT}@${HOOK_CONTEXT.latest}`,
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
