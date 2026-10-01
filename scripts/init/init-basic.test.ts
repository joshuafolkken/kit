import { describe, expect, it } from 'vitest'
import { init_basic } from './init-basic'
import { init_logic } from './init-logic'
import type { ProjectShape } from './project-profile'

const SHAPE: ProjectShape = {
	profile: 'basic',
	reason: 'test',
	has_web: false,
	has_typescript: false,
	has_git: false,
	has_github: false,
}
const VERSIONS = { kit: '1.0.0', prettier: '^3.0.0' }
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'

describe('basic project manifest', () => {
	it('creates a manifest with the safe-chain preinstall and no Git lifecycle scripts', () => {
		const initial = init_basic.initial_manifest()
		const result = JSON.parse(init_basic.merge_basic_manifest(initial, SHAPE, VERSIONS)) as {
			josh: { profile: string }
			scripts: Record<string, string>
			devDependencies: Record<string, string>
		}

		expect(result.josh.profile).toBe('basic')
		expect(result.scripts).toEqual({ preinstall: init_logic.SAFE_CHAIN_CMD, josh: 'josh' })
		expect(result.devDependencies).toEqual({ [KIT_PACKAGE_NAME]: '1.0.0' })
	})

	it('keeps an existing preinstall and stays idempotent on rerun', () => {
		const existing = '{"scripts":{"preinstall":"npx only-allow pnpm"}}'
		const once = init_basic.merge_basic_manifest(existing, SHAPE, VERSIONS)
		const twice = init_basic.merge_basic_manifest(once, SHAPE, VERSIONS)
		const result = JSON.parse(once) as { scripts: Record<string, string> }

		expect(result.scripts['preinstall']).toBe('npx only-allow pnpm')
		expect(twice).toBe(once)
	})

	it('adds Prettier only when a Web file exists and remains idempotent', () => {
		const shape = { ...SHAPE, has_web: true }
		const once = init_basic.merge_basic_manifest('{"name":"example"}', shape, VERSIONS)
		const twice = init_basic.merge_basic_manifest(once, shape, VERSIONS)

		expect(twice).toBe(once)
		expect(once).toContain('"prettier"')
	})
})
