import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const SVELTEKIT_PRESET = './node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc'
const VANILLA_PRESET = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'
const SVELTE_KIT_EXTEND = './.svelte-kit/tsconfig.json'

function generated_extends(): Array<string> {
	return (JSON.parse(init_logic.generate_tsconfig('sveltekit')) as { extends: Array<string> })
		.extends
}

describe('generate_tsconfig', () => {
	it('sveltekit lists the kit preset first and svelte-kit config last', () => {
		expect(generated_extends()).toStrictEqual([SVELTEKIT_PRESET, SVELTE_KIT_EXTEND])
	})

	it('vanilla includes only our config as direct jsonc path', () => {
		const result = init_logic.generate_tsconfig('vanilla')

		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/base.jsonc')
		expect(result).not.toContain('.svelte-kit')
	})

	it('produces the same sveltekit extends order that sync converges to', () => {
		const synced = JSON.parse(
			init_logic.merge_json_extends(
				`{"extends":["${SVELTE_KIT_EXTEND}"]}`,
				init_logic.get_tsconfig_extends_entry('sveltekit'),
			),
		) as { extends: Array<string> }

		expect(generated_extends()).toStrictEqual(synced.extends)
	})
})

describe('get_tsconfig_extends_entry', () => {
	it('returns direct node_modules jsonc path for each project type', () => {
		expect(init_logic.get_tsconfig_extends_entry('sveltekit')).toBe(SVELTEKIT_PRESET)
		expect(init_logic.get_tsconfig_extends_entry('vanilla')).toBe(VANILLA_PRESET)
	})
})
