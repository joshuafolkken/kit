import { describe, expect, it } from 'vitest'
import { kit_package_descriptor, KIT_PACKAGE_NAME } from './kit-descriptor'
import { derive_versions_endpoint } from './version-command-config'

const KIT_PACKAGE = '@joshuafolkken/kit'

describe('kit_package_descriptor', () => {
	it('names the @joshuafolkken/kit package', () => {
		expect(kit_package_descriptor.package_name).toBe(KIT_PACKAGE)
		expect(KIT_PACKAGE_NAME).toBe(KIT_PACKAGE)
	})

	it('derives to the exact kit GitHub Packages versions endpoint', () => {
		expect(derive_versions_endpoint(kit_package_descriptor.package_name)).toBe(
			'/users/joshuafolkken/packages/npm/kit/versions?per_page=1',
		)
	})
})
