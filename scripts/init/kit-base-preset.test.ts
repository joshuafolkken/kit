import { describe, expect, it } from 'vitest'
import { kit_base_preset } from './kit-base-preset'

const KIT_LEFTHOOK = 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml'
const APP_KIT_LEFTHOOK = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'
const KIT_CSPELL = '@joshuafolkken/kit/cspell'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const KIT_TSCONFIG = './node_modules/@joshuafolkken/kit/tsconfig/base.json'
const APP_KIT_TSCONFIG = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json'
const UNRELATED = './.svelte-kit/tsconfig.json'
// In-repo relative preset paths a self-hosting repo (app-kit's own repo) uses — no
// `@joshuafolkken/` prefix, so only the `*/sveltekit` segment match catches them (#664).
const SELF_HOSTED_TSCONFIG = './tsconfig/sveltekit.json'
const SELF_HOSTED_CSPELL = './cspell/sveltekit.yaml'
const SELF_HOSTED_LEFTHOOK = 'lefthook/sveltekit.yml'

describe('kit_base_preset.is_lefthook_base_present', () => {
	it('detects an app-kit lefthook preset', () => {
		expect(kit_base_preset.is_lefthook_base_present([APP_KIT_LEFTHOOK])).toBe(true)
	})

	it('detects kit own lefthook preset', () => {
		expect(kit_base_preset.is_lefthook_base_present([KIT_LEFTHOOK])).toBe(true)
	})

	it('detects a self-hosted relative sveltekit lefthook preset', () => {
		expect(kit_base_preset.is_lefthook_base_present([SELF_HOSTED_LEFTHOOK])).toBe(true)
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

	it('detects a self-hosted relative sveltekit cspell preset', () => {
		expect(kit_base_preset.is_cspell_base_present([SELF_HOSTED_CSPELL])).toBe(true)
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

	it('detects a self-hosted relative sveltekit tsconfig preset', () => {
		expect(kit_base_preset.is_tsconfig_base_present([SELF_HOSTED_TSCONFIG, UNRELATED])).toBe(true)
	})

	it('returns false when only unrelated extends are present', () => {
		// `.svelte-kit` is hyphenated, so the segment-anchored `sveltekit` match must NOT fire on it.
		expect(kit_base_preset.is_tsconfig_base_present([UNRELATED])).toBe(false)
	})

	it('does not treat a segment-anchor sveltekit sibling as a preset', () => {
		// `sveltekit-foo` / `base-sveltekit` are distinct siblings, not the `sveltekit` preset, so
		// kit base must still be injected when only such an entry is present (#664).
		expect(kit_base_preset.is_tsconfig_base_present(['./tsconfig/sveltekit-foo.json'])).toBe(false)
		expect(kit_base_preset.is_tsconfig_base_present(['./tsconfig/base-sveltekit.json'])).toBe(false)
	})
})
