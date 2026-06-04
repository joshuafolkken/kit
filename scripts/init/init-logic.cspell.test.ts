import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const CSPELL_VALUE_VANILLA = '@joshuafolkken/kit/cspell'
const CSPELL_VALUE_SVELTEKIT = '@joshuafolkken/kit/cspell/sveltekit'
const VERSION_LINE = "version: '0.2'\n"

describe('generate_cspell_config', () => {
	it('uses vanilla import path for vanilla projects', () => {
		const result = init_logic.generate_cspell_config('vanilla')

		expect(result).toContain(CSPELL_VALUE_VANILLA)
		expect(result).not.toContain('node_modules')
		expect(result).not.toContain('sveltekit')
	})

	it('uses sveltekit import path for sveltekit projects', () => {
		const result = init_logic.generate_cspell_config('sveltekit')

		expect(result).toContain(CSPELL_VALUE_SVELTEKIT)
		expect(result).not.toContain('node_modules')
	})
})

describe('get_cspell_import_value', () => {
	it('returns the vanilla import path for vanilla projects', () => {
		expect(init_logic.get_cspell_import_value('vanilla')).toBe(CSPELL_VALUE_VANILLA)
	})

	it('returns the sveltekit import path for sveltekit projects', () => {
		expect(init_logic.get_cspell_import_value('sveltekit')).toBe(CSPELL_VALUE_SVELTEKIT)
	})
})

describe('merge_cspell_import', () => {
	it('inserts import block after version line when import key is absent', () => {
		const result = init_logic.merge_cspell_import(
			`${VERSION_LINE}words: []\n`,
			CSPELL_VALUE_VANILLA,
		)

		expect(result).toBe(`${VERSION_LINE}import:\n  - '${CSPELL_VALUE_VANILLA}'\nwords: []\n`)
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
		const content = `${VERSION_LINE}import:\n  - '${CSPELL_VALUE_VANILLA}'\n`

		expect(init_logic.merge_cspell_import(content, CSPELL_VALUE_VANILLA)).toBe(content)
	})

	it('appends import block at end when no version key exists', () => {
		const result = init_logic.merge_cspell_import('words: []\n', CSPELL_VALUE_VANILLA)

		expect(result).toBe(`words: []\nimport:\n  - '${CSPELL_VALUE_VANILLA}'\n`)
	})

	it('inserts sveltekit import path for sveltekit projects', () => {
		const result = init_logic.merge_cspell_import(
			`${VERSION_LINE}words: []\n`,
			CSPELL_VALUE_SVELTEKIT,
		)

		expect(result).toContain(CSPELL_VALUE_SVELTEKIT)
	})
})
