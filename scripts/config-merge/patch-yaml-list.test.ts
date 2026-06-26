import { describe, expect, it } from 'vitest'
import { yaml_list } from './patch-yaml-list'

const IMPORT_FIELD = 'import'
const KIT_SVELTEKIT = '@joshuafolkken/kit/cspell/sveltekit'
const APP_KIT_SVELTEKIT = '@joshuafolkken/app-kit/cspell/sveltekit'
const VERSION_LINE = 'version: "0.2"\n'

describe('yaml_list.read_yaml_list_field', () => {
	it('reads an existing list field', () => {
		const content = `${IMPORT_FIELD}:\n  - "${KIT_SVELTEKIT}"\n`

		expect(yaml_list.read_yaml_list_field(content, IMPORT_FIELD)).toEqual([KIT_SVELTEKIT])
	})

	it('returns an empty array when the field is absent', () => {
		expect(yaml_list.read_yaml_list_field('words: []\n', IMPORT_FIELD)).toEqual([])
	})
})

describe('yaml_list.patch_yaml_list_field — new field placement', () => {
	it('inserts a new field after the anchor key (cspell after version)', () => {
		const result = yaml_list.patch_yaml_list_field(`${VERSION_LINE}words: []\n`, {
			field: IMPORT_FIELD,
			ensure: [APP_KIT_SVELTEKIT],
			position: { after: 'version' },
			quote_style: 'double',
		})

		expect(result).toBe(`${VERSION_LINE}import:\n  - "${APP_KIT_SVELTEKIT}"\nwords: []\n`)
	})

	it('falls back to the end when the anchor key is absent', () => {
		const result = yaml_list.patch_yaml_list_field('words: []\n', {
			field: IMPORT_FIELD,
			ensure: [APP_KIT_SVELTEKIT],
			position: { after: 'version' },
			quote_style: 'double',
		})

		expect(result).toBe(`words: []\nimport:\n  - "${APP_KIT_SVELTEKIT}"\n`)
	})

	it('places a new field at the front when position is front', () => {
		const result = yaml_list.patch_yaml_list_field('words: []\n', {
			field: 'extends',
			ensure: ['base'],
			position: 'front',
		})

		expect(result).toBe(`extends:\n  - base\nwords: []\n`)
	})
})

describe('yaml_list.patch_yaml_list_field — existing field', () => {
	it('prepends to an existing list and preserves other keys', () => {
		const content = `${VERSION_LINE}import:\n  - other\nwords:\n  - preserved\n`
		const result = yaml_list.patch_yaml_list_field(content, {
			field: IMPORT_FIELD,
			ensure: [APP_KIT_SVELTEKIT],
		})

		expect(result).toContain(APP_KIT_SVELTEKIT)
		expect(result).toContain('other')
		expect(result).toContain('preserved')
	})
})

describe('yaml_list.patch_yaml_list_field — remove', () => {
	it('removes an entry matching a pattern', () => {
		const content = `import:\n  - "${KIT_SVELTEKIT}"\n  - keep\n`
		const result = yaml_list.patch_yaml_list_field(content, {
			field: IMPORT_FIELD,
			remove: [/\/sveltekit$/u],
		})

		expect(result).not.toContain(KIT_SVELTEKIT)
		expect(result).toContain('keep')
	})

	it('swaps the kit sveltekit line for the app-kit one, preserving words', () => {
		const content = `${VERSION_LINE}import:\n  - "${KIT_SVELTEKIT}"\nwords:\n  - preserved\n`
		const result = yaml_list.patch_yaml_list_field(content, {
			field: IMPORT_FIELD,
			ensure: [APP_KIT_SVELTEKIT],
			remove: [KIT_SVELTEKIT],
			quote_style: 'double',
		})

		expect(result).toContain(APP_KIT_SVELTEKIT)
		expect(result).not.toContain(KIT_SVELTEKIT)
		expect(result).toContain('preserved')
	})
})

describe('yaml_list.patch_yaml_list_field — idempotency', () => {
	it('returns content unchanged when the ensure entry is already present', () => {
		const content = `${VERSION_LINE}import:\n  - "${APP_KIT_SVELTEKIT}"\n`

		expect(
			yaml_list.patch_yaml_list_field(content, {
				field: IMPORT_FIELD,
				ensure: [APP_KIT_SVELTEKIT],
				quote_style: 'double',
			}),
		).toBe(content)
	})

	it('is a no-op on a second run', () => {
		const first = yaml_list.patch_yaml_list_field(`${VERSION_LINE}words: []\n`, {
			field: IMPORT_FIELD,
			ensure: [APP_KIT_SVELTEKIT],
			position: { after: 'version' },
			quote_style: 'double',
		})
		const second = yaml_list.patch_yaml_list_field(first, {
			field: IMPORT_FIELD,
			ensure: [APP_KIT_SVELTEKIT],
			position: { after: 'version' },
			quote_style: 'double',
		})

		expect(second).toBe(first)
	})

	it('returns content unchanged when removing an absent entry', () => {
		const content = `import:\n  - keep\n`

		expect(
			yaml_list.patch_yaml_list_field(content, { field: IMPORT_FIELD, remove: [KIT_SVELTEKIT] }),
		).toBe(content)
	})
})
