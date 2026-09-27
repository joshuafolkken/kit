import { describe, expect, it } from 'vitest'
import { init_static } from './init-static'
import type { ProjectShape } from './project-profile'

const SHAPE: ProjectShape = {
	profile: 'static',
	reason: 'test',
	has_web: false,
	has_typescript: false,
	has_git: false,
	has_github: false,
}
const VERSIONS = { kit: '1.0.0', prettier: '^3.0.0' }
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'

describe('static project manifest', () => {
	it('creates a manifest and records the profile without lifecycle scripts', () => {
		const initial = init_static.initial_manifest()
		const result = JSON.parse(init_static.merge_static_manifest(initial, SHAPE, VERSIONS)) as {
			josh: { profile: string }
			scripts: Record<string, string>
			devDependencies: Record<string, string>
		}

		expect(result.josh.profile).toBe('static')
		expect(result.scripts).toEqual({ josh: 'josh' })
		expect(result.devDependencies).toEqual({ [KIT_PACKAGE_NAME]: '1.0.0' })
	})

	it('adds Prettier only when a Web file exists and remains idempotent', () => {
		const shape = { ...SHAPE, has_web: true }
		const once = init_static.merge_static_manifest('{"name":"example"}', shape, VERSIONS)
		const twice = init_static.merge_static_manifest(once, shape, VERSIONS)

		expect(twice).toBe(once)
		expect(once).toContain('"prettier"')
	})
})
