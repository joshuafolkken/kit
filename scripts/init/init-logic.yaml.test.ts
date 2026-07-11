import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const UNCHANGED_WHEN_PRESENT = 'returns content unchanged when value already present'
const EXTENDS_KEY = 'extends'
const KIT_ESLINT_SVELTEKIT = '@joshuafolkken/kit/eslint/sveltekit'
const KIT_ESLINT = '@joshuafolkken/kit/eslint'
const CSPELL_VALUE = '@joshuafolkken/kit/cspell'
const WORKSPACE_TEMPLATE = 'allowBuilds:\n  esbuild: true\n\nminimumReleaseAgeExclude:\n  - vite\n'
const PACKAGES_KEY = 'packages:'
const ALLOW_BUILDS_KEY = 'allowBuilds:'
const DEPRECATED_ONLY_BUILT_KEY = 'onlyBuiltDependencies:'
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

	// js-yaml 5 throws on input with no document node (empty / whitespace / comment-only),
	// where js-yaml 4 returned undefined. Guards the parse_yaml empty-document handling (#599).
	it('treats comment-only content as empty and creates the key', () => {
		const result = init_logic.merge_yaml_list_entry('# only a comment\n', EXTENDS_KEY, KIT_ESLINT)

		expect(result).toContain(EXTENDS_KEY)
		expect(result).toContain(KIT_ESLINT)
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
	// A non-ecosystem existing import must not trip the ecosystem-base dedup, so kit's base is added.
	it('adds value to an existing non-ecosystem import list', () => {
		const result = init_logic.merge_cspell_import(`import:\n  - 'some-other-dict'\n`, CSPELL_VALUE)

		expect(result).toContain(CSPELL_VALUE)
		expect(result).toContain('some-other-dict')
	})

	it('creates import section when key absent', () => {
		const result = init_logic.merge_cspell_import('version: 2\n', CSPELL_VALUE)

		expect(result).toContain('import')
		expect(result).toContain(CSPELL_VALUE)
	})
})

const KIT_LEFTHOOK_VANILLA = 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml'
const APP_KIT_LEFTHOOK = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'

describe('merge_lefthook_extends — ecosystem base dedup', () => {
	// Adding kit vanilla next to an app-kit preset would extend lefthook/base.yml twice — the
	// hard "possible recursion in extends" crash this guard prevents (#660).
	it('skips kit base when an app-kit lefthook preset is present', () => {
		const content = `${EXTENDS_KEY}:\n  - ${APP_KIT_LEFTHOOK}\n`
		const result = init_logic.merge_lefthook_extends(content, KIT_LEFTHOOK_VANILLA)

		expect(result).toBe(content)
		expect(result).not.toContain(KIT_LEFTHOOK_VANILLA)
	})

	it('adds kit base when no ecosystem lefthook preset is present', () => {
		const result = init_logic.merge_lefthook_extends(`${EXTENDS_KEY}: []\n`, KIT_LEFTHOOK_VANILLA)

		expect(result).toContain(KIT_LEFTHOOK_VANILLA)
	})
})

const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'

describe('merge_cspell_import — ecosystem base dedup', () => {
	// app-kit's cspell preset already imports kit's cspell base, so re-adding it is a redundant
	// double import (#660).
	it('skips kit base when an app-kit cspell preset is present', () => {
		const content = `import:\n  - '${APP_KIT_CSPELL}'\n`
		const result = init_logic.merge_cspell_import(content, CSPELL_VALUE)

		expect(result).toBe(content)
		expect(result).not.toContain(`- '${CSPELL_VALUE}'`)
	})
})

describe('merge_workspace_yaml - empty and kit-only cases', () => {
	it('returns template when existing is empty string', () => {
		expect(init_logic.merge_workspace_yaml('', WORKSPACE_TEMPLATE)).toBe(WORKSPACE_TEMPLATE)
	})

	it('preserves existing when it has only kit-managed keys', () => {
		const existing = `${ALLOW_BUILDS_KEY}\n  esbuild: true\nminimumReleaseAgeExclude:\n  - vite\n`

		expect(init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)).toBe(existing)
	})

	it('drops deprecated onlyBuiltDependencies and outputs allowBuilds from template', () => {
		const existing = `${DEPRECATED_ONLY_BUILT_KEY}\n  - old-value\n`
		const result = init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)

		expect(result).toContain(ALLOW_BUILDS_KEY)
		expect(result).not.toContain(DEPRECATED_ONLY_BUILT_KEY)
		expect(result).not.toContain('old-value')
	})
})

describe('merge_workspace_yaml - user key preservation', () => {
	it('preserves user-defined keys and drops deprecated onlyBuiltDependencies', () => {
		const existing = `${PACKAGES_KEY}\n  - "@joshuafolkken/kit"\n${DEPRECATED_ONLY_BUILT_KEY}\n  - esbuild\n`
		const result = init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)

		expect(result).toContain(PACKAGES_KEY)
		expect(result).toContain(KIT_LIST_ENTRY)
		expect(result).not.toContain(DEPRECATED_ONLY_BUILT_KEY)
	})

	it('includes kit-managed keys from template and preserves multiple user keys', () => {
		const existing =
			'packages:\n  - "@joshuafolkken/kit"\ncatalogs:\n  default:\n    react: ^19.0.0\n'
		const result = init_logic.merge_workspace_yaml(existing, WORKSPACE_TEMPLATE)

		expect(result).toContain(ALLOW_BUILDS_KEY)
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
