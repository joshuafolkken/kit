import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const VANILLA_PRESET = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'

describe('generate_tsconfig', () => {
	it('includes only our config as direct jsonc path', () => {
		const result = init_logic.generate_tsconfig()

		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/base.jsonc')
		expect(result).not.toContain('.svelte-kit')
	})
})

describe('get_tsconfig_extends_entry', () => {
	it('returns direct node_modules jsonc path', () => {
		expect(init_logic.get_tsconfig_extends_entry()).toBe(VANILLA_PRESET)
	})
})
