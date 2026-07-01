import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const CSPELL_VALUE_VANILLA = '@joshuafolkken/kit/cspell'
const VERSION_LINE = 'version: "0.2"\n'

describe('generate_cspell_config', () => {
	it('uses the kit import path', () => {
		const result = init_logic.generate_cspell_config()

		expect(result).toContain(CSPELL_VALUE_VANILLA)
		expect(result).not.toContain('node_modules')
		expect(result).not.toContain('sveltekit')
	})

	it('emits double-quoted scalars to match the VSCode cspell extension format', () => {
		const result = init_logic.generate_cspell_config()

		expect(result).toContain(VERSION_LINE)
		expect(result).toContain(`- "${CSPELL_VALUE_VANILLA}"`)
		expect(result).not.toContain("'")
	})
})

describe('get_cspell_import_value', () => {
	it('returns the kit import path', () => {
		expect(init_logic.get_cspell_import_value()).toBe(CSPELL_VALUE_VANILLA)
	})
})

describe('merge_cspell_import', () => {
	it('inserts import block after version line when import key is absent', () => {
		const result = init_logic.merge_cspell_import(
			`${VERSION_LINE}words: []\n`,
			CSPELL_VALUE_VANILLA,
		)

		expect(result).toBe(`${VERSION_LINE}import:\n  - "${CSPELL_VALUE_VANILLA}"\nwords: []\n`)
	})

	it('adds entry to existing import list when import key already exists', () => {
		const result = init_logic.merge_cspell_import(
			`${VERSION_LINE}import:\n  - other\n`,
			CSPELL_VALUE_VANILLA,
		)

		expect(result).toContain(CSPELL_VALUE_VANILLA)
		expect(result).toContain('other')
	})

	it('returns content unchanged when value already present', () => {
		const content = `${VERSION_LINE}import:\n  - "${CSPELL_VALUE_VANILLA}"\n`

		expect(init_logic.merge_cspell_import(content, CSPELL_VALUE_VANILLA)).toBe(content)
	})

	it('appends import block at end when no version key exists', () => {
		const result = init_logic.merge_cspell_import('words: []\n', CSPELL_VALUE_VANILLA)

		expect(result).toBe(`words: []\nimport:\n  - "${CSPELL_VALUE_VANILLA}"\n`)
	})
})
