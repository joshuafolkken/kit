import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const CSPELL_VALUE = '@joshuafolkken/config/cspell'

describe('generate_cspell_config', () => {
	it('uses the short package import path and not node_modules', () => {
		const result = init_logic.generate_cspell_config()

		expect(result).toContain(CSPELL_VALUE)
		expect(result).not.toContain('node_modules')
	})
})

describe('get_cspell_import_value', () => {
	it('returns the short package import path', () => {
		expect(init_logic.get_cspell_import_value()).toBe(CSPELL_VALUE)
	})
})

describe('merge_cspell_import', () => {
	it('inserts import block after version line when import key is absent', () => {
		const result = init_logic.merge_cspell_import("version: '0.2'\nwords: []\n", CSPELL_VALUE)

		expect(result).toBe(`version: '0.2'\nimport:\n  - ${CSPELL_VALUE}\nwords: []\n`)
	})

	it('adds entry to existing import list when import key already exists', () => {
		const result = init_logic.merge_cspell_import(
			"version: '0.2'\nimport:\n  - other\n",
			CSPELL_VALUE,
		)

		expect(result).toContain(CSPELL_VALUE)
		expect(result).toContain('other')
	})

	it('returns content unchanged when value already present', () => {
		const content = `version: '0.2'\nimport:\n  - ${CSPELL_VALUE}\n`

		expect(init_logic.merge_cspell_import(content, CSPELL_VALUE)).toBe(content)
	})

	it('appends import block at end when no version key exists', () => {
		const result = init_logic.merge_cspell_import('words: []\n', CSPELL_VALUE)

		expect(result).toBe(`words: []\nimport:\n  - ${CSPELL_VALUE}\n`)
	})
})
