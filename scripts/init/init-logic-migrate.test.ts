import { describe, expect, it } from 'vitest'
import { apply_jf_migrations, remove_retired_scripts } from './init-logic-migrate'

describe('apply_jf_migrations', () => {
	it('renames jf- prefixed values to josh prefix', () => {
		expect(apply_jf_migrations({ build: 'jf-build', test: 'jf-test' })).toEqual({
			build: 'josh build',
			test: 'josh test',
		})
	})

	it('leaves non-jf values unchanged', () => {
		expect(apply_jf_migrations({ dev: 'vite dev' })).toEqual({ dev: 'vite dev' })
	})

	it('returns empty object for empty input', () => {
		expect(apply_jf_migrations({})).toEqual({})
	})
})

describe('remove_retired_scripts', () => {
	it('removes retired keys whose value runs kit', () => {
		const result = remove_retired_scripts({ lint: 'josh lint', dev: 'vite dev' })

		expect(result).not.toHaveProperty('lint')
		expect(result).toHaveProperty('dev')
	})

	it('removes a retired key still holding a jf- value', () => {
		expect(remove_retired_scripts({ format: 'jf-format' })).toEqual({})
	})

	it('removes a retired key still holding the plain value kit wrote before #80', () => {
		const scripts = Object.fromEntries([
			['test:unit', 'vitest run'],
			['dev', 'vite dev'],
		])

		expect(remove_retired_scripts(scripts)).toEqual({ dev: 'vite dev' })
	})

	it('keeps a retired key whose value the project wrote itself (regression #3069)', () => {
		const sv_check = 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json'

		expect(remove_retired_scripts({ check: sv_check, lint: 'eslint .' })).toEqual({
			check: sv_check,
			lint: 'eslint .',
		})
	})

	it('preserves non-retired keys unchanged', () => {
		expect(remove_retired_scripts({ dev: 'vite dev' })).toEqual({ dev: 'vite dev' })
	})
})
