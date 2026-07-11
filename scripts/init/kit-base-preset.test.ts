import { describe, expect, it } from 'vitest'
import { kit_base_preset } from './kit-base-preset'

const KIT_LEFTHOOK = 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml'
const APP_KIT_LEFTHOOK = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'
const KIT_CSPELL = '@joshuafolkken/kit/cspell'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const KIT_TSCONFIG = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'
const APP_KIT_TSCONFIG = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const UNRELATED = './.svelte-kit/tsconfig.json'

describe('kit_base_preset.is_lefthook_base_present', () => {
	it('detects an app-kit lefthook preset', () => {
		expect(kit_base_preset.is_lefthook_base_present([APP_KIT_LEFTHOOK])).toBe(true)
	})

	it('detects kit own lefthook preset', () => {
		expect(kit_base_preset.is_lefthook_base_present([KIT_LEFTHOOK])).toBe(true)
	})

	it('returns false for an empty or unrelated list', () => {
		expect(kit_base_preset.is_lefthook_base_present([])).toBe(false)
		expect(kit_base_preset.is_lefthook_base_present(['./local.yml'])).toBe(false)
	})
})

describe('kit_base_preset.is_cspell_base_present', () => {
	it('detects an app-kit cspell preset (subpath)', () => {
		expect(kit_base_preset.is_cspell_base_present([APP_KIT_CSPELL])).toBe(true)
	})

	it('detects the bare kit cspell base import', () => {
		expect(kit_base_preset.is_cspell_base_present([KIT_CSPELL])).toBe(true)
	})

	it('returns false for an unrelated import', () => {
		expect(kit_base_preset.is_cspell_base_present(['@some/other/cspell-dict'])).toBe(false)
	})
})

describe('kit_base_preset.is_tsconfig_base_present', () => {
	it('detects an app-kit tsconfig preset', () => {
		expect(kit_base_preset.is_tsconfig_base_present([APP_KIT_TSCONFIG, UNRELATED])).toBe(true)
	})

	it('detects kit own tsconfig base', () => {
		expect(kit_base_preset.is_tsconfig_base_present([KIT_TSCONFIG])).toBe(true)
	})

	it('returns false when only unrelated extends are present', () => {
		expect(kit_base_preset.is_tsconfig_base_present([UNRELATED])).toBe(false)
	})
})
