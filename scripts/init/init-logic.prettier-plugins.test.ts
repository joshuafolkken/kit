import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const DEV_DEPS_KEY = 'devDependencies'
const SORT_IMPORTS_KEY = '@ianvs/prettier-plugin-sort-imports'
const PRETTIER_SVELTE_KEY = 'prettier-plugin-svelte'
const PRETTIER_TAILWIND_KEY = 'prettier-plugin-tailwindcss'
const SORT_IMPORTS_VERSION = '^4.7.1'

describe('merge_prettier_plugin_development_deps', () => {
	it('adds all three prettier preset plugins as devDependencies', () => {
		const result = JSON.parse(init_logic.merge_prettier_plugin_development_deps('{}')) as Record<
			string,
			Record<string, string>
		>

		expect(result[DEV_DEPS_KEY]?.[SORT_IMPORTS_KEY]).toBe(SORT_IMPORTS_VERSION)
		expect(result[DEV_DEPS_KEY]?.[PRETTIER_SVELTE_KEY]).toBe('^4.1.1')
		expect(result[DEV_DEPS_KEY]?.[PRETTIER_TAILWIND_KEY]).toBe('^0.8.0')
	})

	it('does not overwrite existing prettier plugin versions', () => {
		const existing = `{"${DEV_DEPS_KEY}":{"${PRETTIER_SVELTE_KEY}":"^3.0.0"}}`
		const result = JSON.parse(
			init_logic.merge_prettier_plugin_development_deps(existing),
		) as Record<string, Record<string, string>>

		expect(result[DEV_DEPS_KEY]?.[PRETTIER_SVELTE_KEY]).toBe('^3.0.0')
		expect(result[DEV_DEPS_KEY]?.[SORT_IMPORTS_KEY]).toBe(SORT_IMPORTS_VERSION)
	})
})
