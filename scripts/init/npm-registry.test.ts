import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const GITHUB_REGISTRY = '@joshuafolkken:registry=https://npm.pkg.github.com'
const AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'

describe('existing npm registry settings', () => {
	it('preserves existing GitHub routing and credentials during sync', () => {
		const existing = `${GITHUB_REGISTRY}\n${AUTH_LINE}\n`

		expect(init_logic.merge_npmrc(existing)).toBe(existing)
	})

	it('keeps the routing and credentials while the legacy settings lines are stripped', () => {
		const existing = `${GITHUB_REGISTRY}\nengine-strict=true\n${AUTH_LINE}\nconfirmModulesPurge=false\n`

		expect(init_logic.merge_npmrc(existing)).toBe(`${GITHUB_REGISTRY}\n${AUTH_LINE}\n`)
	})
})
