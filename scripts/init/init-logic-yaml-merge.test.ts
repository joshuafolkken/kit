import { describe, expect, it } from 'vitest'
import { init_logic_yaml_merge } from './init-logic-yaml-merge'

const EXTENDS_KEY = 'extends'
const KIT_LEFTHOOK = 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml'
const APP_KIT_LEFTHOOK = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'
const KIT_CSPELL = '@joshuafolkken/kit/cspell'
const CSPELL_VERSION_LINE = 'version: "0.2"\n'
const KIT_CSPELL_IMPORT = `import:\n  - "${KIT_CSPELL}"\n`

describe('init_logic_yaml_merge.merge_yaml_list_entry', () => {
	it('creates the list field when content is empty', () => {
		expect(init_logic_yaml_merge.merge_yaml_list_entry('', EXTENDS_KEY, 'a')).toBe(
			'extends:\n  - a\n',
		)
	})

	it('places a new list field at the front of the document', () => {
		expect(init_logic_yaml_merge.merge_yaml_list_entry('foo: 1\n', EXTENDS_KEY, 'a')).toBe(
			'extends:\n  - a\nfoo: 1\n',
		)
	})

	it('prepends the value to an existing list', () => {
		expect(init_logic_yaml_merge.merge_yaml_list_entry('extends:\n  - b\n', EXTENDS_KEY, 'a')).toBe(
			'extends:\n  - a\n  - b\n',
		)
	})
})

describe('init_logic_yaml_merge.merge_lefthook_extends', () => {
	it('adds the kit preset at the front when no extends list exists', () => {
		const content = 'pre-commit:\n  commands: {}\n'

		expect(init_logic_yaml_merge.merge_lefthook_extends(content, KIT_LEFTHOOK)).toBe(
			`extends:\n  - ${KIT_LEFTHOOK}\n${content}`,
		)
	})

	it('leaves content unchanged when an ecosystem lefthook preset is already extended', () => {
		const content = `extends:\n  - ${APP_KIT_LEFTHOOK}\n`

		expect(init_logic_yaml_merge.merge_lefthook_extends(content, KIT_LEFTHOOK)).toBe(content)
	})

	it('leaves content unchanged when a relative sveltekit preset is extended', () => {
		const content = 'extends:\n  - lefthook/sveltekit.yml\n'

		expect(init_logic_yaml_merge.merge_lefthook_extends(content, KIT_LEFTHOOK)).toBe(content)
	})
})

describe('init_logic_yaml_merge.merge_cspell_import', () => {
	it('inserts the import block right after the version line with double quotes', () => {
		const content = `${CSPELL_VERSION_LINE}words:\n  - foo\n`

		expect(init_logic_yaml_merge.merge_cspell_import(content, KIT_CSPELL)).toBe(
			`${CSPELL_VERSION_LINE}${KIT_CSPELL_IMPORT}words:\n  - foo\n`,
		)
	})

	it('appends the import block at the end when there is no version line', () => {
		expect(init_logic_yaml_merge.merge_cspell_import('words:\n  - a\n', KIT_CSPELL)).toBe(
			`words:\n  - a\n${KIT_CSPELL_IMPORT}`,
		)
	})

	it('adds the kit base ahead of a non-ecosystem import entry', () => {
		const content = `version: '0.2'\nimport:\n  - other\n`

		expect(init_logic_yaml_merge.merge_cspell_import(content, KIT_CSPELL)).toBe(
			`${CSPELL_VERSION_LINE}${KIT_CSPELL_IMPORT}  - other\n`,
		)
	})

	it('leaves content unchanged when an ecosystem cspell preset is already imported', () => {
		const content = `${CSPELL_VERSION_LINE}import:\n  - "@joshuafolkken/app-kit/cspell/sveltekit"\n`

		expect(init_logic_yaml_merge.merge_cspell_import(content, KIT_CSPELL)).toBe(content)
	})
})
