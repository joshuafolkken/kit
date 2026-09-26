import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const GITHUB_REGISTRY = '@joshuafolkken:registry=https://npm.pkg.github.com'
const AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'

describe('new project npm registry', () => {
	it('uses the default public registry without GitHub authentication', () => {
		const generated = init_logic.generate_npmrc()

		expect(generated).not.toContain(GITHUB_REGISTRY)
		expect(generated).not.toContain(AUTH_LINE)
	})

	it('preserves existing GitHub routing and credentials during sync', () => {
		const existing = `${GITHUB_REGISTRY}\n${AUTH_LINE}\n`
		const merged = init_logic.merge_npmrc(existing)

		expect(merged).toContain(existing)
		expect(init_logic.merge_npmrc(merged)).toBe(merged)
	})

	it('adds a separating newline to incomplete existing settings', () => {
		const merged = init_logic.merge_npmrc(GITHUB_REGISTRY)

		expect(merged).toContain(`${GITHUB_REGISTRY}\nengine-strict=true`)
	})
})
