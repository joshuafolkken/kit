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
	it('removes scripts with keys in RETIRED_MANAGED_SCRIPTS', () => {
		const result = remove_retired_scripts({ lint: 'eslint .', dev: 'vite dev' })

		expect(result).not.toHaveProperty('lint')
		expect(result).toHaveProperty('dev')
	})

	it('returns empty object when all keys are retired', () => {
		expect(remove_retired_scripts({ lint: 'eslint .' })).toEqual({})
	})

	it('preserves non-retired keys unchanged', () => {
		expect(remove_retired_scripts({ dev: 'vite dev' })).toEqual({ dev: 'vite dev' })
	})
})
