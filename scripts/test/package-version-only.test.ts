import { describe, expect, it } from 'vitest'
import { package_version_only } from './package-version-only'

// joshuafolkken/kit#7538: a release commit's `version` bump ran the whole unit suite.

function manifest_of(version: string, dependency = '1.0.0'): string {
	return JSON.stringify({ name: 'kit', version, dependencies: { a: dependency } }, undefined, '\t')
}

describe('package_version_only.is_version_only', () => {
	it('is true when only the version moved', () => {
		expect(package_version_only.is_version_only(manifest_of('1.0.0'), manifest_of('1.1.0'))).toBe(
			true,
		)
	})

	it('is false when a dependency moved with the version', () => {
		const after = manifest_of('1.1.0', '2.0.0')

		expect(package_version_only.is_version_only(manifest_of('1.0.0'), after)).toBe(false)
	})

	it('is false when either side is not JSON', () => {
		expect(package_version_only.is_version_only('{', manifest_of('1.1.0'))).toBe(false)
		expect(package_version_only.is_version_only(manifest_of('1.0.0'), '[]')).toBe(false)
	})
})
