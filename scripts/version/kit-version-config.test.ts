import { describe, expect, it } from 'vitest'
import { kit_version_config } from './kit-version-config'

describe('kit_version_config', () => {
	it('targets the @joshuafolkken/kit package', () => {
		expect(kit_version_config.package_name).toBe('@joshuafolkken/kit')
	})

	it('queries the kit GitHub Packages versions endpoint', () => {
		expect(kit_version_config.versions_endpoint).toBe(
			'/users/joshuafolkken/packages/npm/kit/versions?per_page=1',
		)
	})

	it('derives the kit fix-gh-packages repair path', () => {
		expect(kit_version_config.fix_gh_packages_path).toBe(
			'node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts',
		)
	})

	it('supplies a self_directory so the running-binary line can be reported', () => {
		expect(kit_version_config.self_directory).toBeDefined()
	})

	it('supplies a shadow-warning resolver hook', () => {
		expect(typeof kit_version_config.resolve_warning).toBe('function')
	})
})
