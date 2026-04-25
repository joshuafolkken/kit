import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const UNCHANGED_WHEN_PRESENT = 'returns content unchanged when value already present'
const EXTENDS_KEY = 'extends'
const KIT_ESLINT_SVELTEKIT = '@joshuafolkken/kit/eslint/sveltekit'
const KIT_ESLINT = '@joshuafolkken/kit/eslint'
const CSPELL_VALUE = '@joshuafolkken/kit/cspell'
const CSPELL_SVK_VALUE = '@joshuafolkken/kit/cspell/sveltekit'
const WORKSPACE_TEMPLATE =
	'onlyBuiltDependencies:\n  - esbuild\n\nminimumReleaseAgeExclude:\n  - vite\n'
const PACKAGES_KEY = 'packages:'
const ONLY_BUILT_KEY = 'onlyBuiltDependencies:'
const KIT_LIST_ENTRY = '  - "@joshuafolkken/kit"'

describe('merge_yaml_list_entry — unchanged when present', () => {
	it(UNCHANGED_WHEN_PRESENT, () => {
		const content = `${EXTENDS_KEY}:\n  - '${KIT_ESLINT_SVELTEKIT}'\n`
		const result = init_logic.merge_yaml_list_entry(content, EXTENDS_KEY, KIT_ESLINT_SVELTEKIT)

		expect(result).toBe(content)
	})
})

describe('merge_yaml_list_entry — modification', () => {
	it('adds value to existing list', () => {
		const result = init_logic.merge_yaml_list_entry(
			`${EXTENDS_KEY}:\n  - '${KIT_ESLINT_SVELTEKIT}'\n`,
			EXTENDS_KEY,
			KIT_ESLINT,
		)

		expect(result).toContain(KIT_ESLINT_SVELTEKIT)
		expect(result).toContain(KIT_ESLINT)
	})

	it('creates key with value when key absent from content', () => {
		const result = init_logic.merge_yaml_list_entry('', EXTENDS_KEY, KIT_ESLINT_SVELTEKIT)

		expect(result).toContain(EXTENDS_KEY)
		expect(result).toContain(KIT_ESLINT_SVELTEKIT)
	})

	it('does not falsely match when value is a prefix of an existing entry', () => {
		const content = `${EXTENDS_KEY}:\n  - '${KIT_ESLINT_SVELTEKIT}'\n`
		const result = init_logic.merge_yaml_list_entry(content, EXTENDS_KEY, KIT_ESLINT)

		expect(result).toContain(KIT_ESLINT_SVELTEKIT)
		expect(result).toContain(KIT_ESLINT)
		expect(result).not.toBe(content)
	})
})

describe('merge_cspell_import — unchanged when present', () => {
	it(UNCHANGED_WHEN_PRESENT, () => {
		const content = `import:\n  - '${CSPELL_VALUE}'\n`
		const result = init_logic.merge_cspell_import(content, CSPELL_VALUE)

		expect(result).toBe(content)
	})
})

describe('merge_cspell_import — modification', () => {
	it('adds value to existing import list', () => {
		const result = init_logic.merge_cspell_import(
			`import:\n  - '${CSPELL_SVK_VALUE}'\n`,
			CSPELL_VALUE,
		)

		expect(result).toContain(CSPELL_VALUE)
		expect(result).toContain(CSPELL_SVK_VALUE)
	})

	it('creates import section when key absent', () => {
		const result = init_logic.merge_cspell_import('version: 2\n', CSPELL_VALUE)

		expect(result).toContain('import')
		expect(result).toContain(CSPELL_VALUE)
	})

	it('does not falsely match when value is a prefix of an existing import', () => {
		const content = `import:\n  - '${CSPELL_SVK_VALUE}'\n`
		const result = init_logic.merge_cspell_import(content, CSPELL_VALUE)

		expect(result).toContain(CSPELL_SVK_VALUE)
		expect(result).toContain(CSPELL_VALUE)
		expect(result).not.toBe(content)
	})
})

describe('merge_workspace_yaml - empty and kit-only cases', () => {
	it('returns template when existing is empty string', () => {
		expect(init_logic.merge_workspace_yaml('', WORKSPACE_TEMPLATE)).toBe(WORKSPACE_TEMPLATE)
	})

	it('returns template when existing has only kit-managed keys', () => {
		const existing = 'onlyBuiltDependencies:\n  - esbuild\nminimumReleaseAgeExclude:\n  - vite\n'

		expect(init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)).toBe(WORKSPACE_TEMPLATE)
	})

	it('uses template values for kit-managed keys ignoring existing values', () => {
		const existing = 'onlyBuiltDependencies:\n  - old-value\n'
		const result = init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)

		expect(result).toContain('  - esbuild')
		expect(result).not.toContain('old-value')
	})
})

describe('merge_workspace_yaml - user key preservation', () => {
	it('preserves user-defined keys appended after template content', () => {
		const existing = 'packages:\n  - "@joshuafolkken/kit"\nonlyBuiltDependencies:\n  - esbuild\n'
		const result = init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)

		expect(result).toContain(PACKAGES_KEY)
		expect(result).toContain(KIT_LIST_ENTRY)
		expect(result).toContain(ONLY_BUILT_KEY)
	})

	it('includes kit-managed keys from template and preserves multiple user keys', () => {
		const existing =
			'packages:\n  - "@joshuafolkken/kit"\ncatalogs:\n  default:\n    react: ^19.0.0\n'
		const result = init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)

		expect(result).toContain(ONLY_BUILT_KEY)
		expect(result).toContain('minimumReleaseAgeExclude:')
		expect(result).toContain(PACKAGES_KEY)
		expect(result).toContain('catalogs:')
	})

	it('preserves last user block value when existing lacks trailing newline', () => {
		const result = init_logic.merge_workspace_yaml(
			`${PACKAGES_KEY}\n${KIT_LIST_ENTRY}`,
			WORKSPACE_TEMPLATE,
		)

		expect(result).toContain(KIT_LIST_ENTRY)
	})
})
