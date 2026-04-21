import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

describe('merge_json_extends', () => {
	it('adds extends when key is missing', () => {
		const result = JSON.parse(init_logic.merge_json_extends('{}', 'my-config')) as {
			extends: unknown
		}

		expect(result.extends).toStrictEqual(['my-config'])
	})

	it('converts string extends to array and prepends entry', () => {
		const result = JSON.parse(
			init_logic.merge_json_extends('{"extends":"existing"}', 'my-config'),
		) as { extends: unknown }

		expect(result.extends).toStrictEqual(['my-config', 'existing'])
	})

	it('prepends to existing array', () => {
		const result = JSON.parse(
			init_logic.merge_json_extends('{"extends":["existing"]}', 'my-config'),
		) as { extends: unknown }

		expect(result.extends).toStrictEqual(['my-config', 'existing'])
	})

	it('returns content unchanged when entry already in extends', () => {
		const content = '{"extends":["my-config"]}'
		const result = init_logic.merge_json_extends(content, 'my-config')

		expect(result).toBe(content)
	})

	it('handles tsconfig.json with JSONC line comments', () => {
		const content = '{\n\t// compiler options\n\t"extends": ["existing"]\n}'
		const result = JSON.parse(init_logic.merge_json_extends(content, 'my-config')) as {
			extends: unknown
		}

		expect(result.extends).toStrictEqual(['my-config', 'existing'])
	})
})

describe('merge_json_array_field', () => {
	it('adds values to an empty array', () => {
		const result = JSON.parse(
			init_logic.merge_json_array_field('{"recommendations":[]}', 'recommendations', ['a', 'b']),
		) as { recommendations: unknown }

		expect(result.recommendations).toStrictEqual(['a', 'b'])
	})

	it('adds only values not already present', () => {
		const result = JSON.parse(
			init_logic.merge_json_array_field('{"recommendations":["a"]}', 'recommendations', ['a', 'b']),
		) as { recommendations: unknown }

		expect(result.recommendations).toStrictEqual(['a', 'b'])
	})

	it('returns content unchanged when all values already present', () => {
		const content = '{"recommendations":["a","b"]}'
		const result = init_logic.merge_json_array_field(content, 'recommendations', ['a', 'b'])

		expect(result).toBe(content)
	})

	it('handles extensions.json with JSONC line comments', () => {
		const content = '{\n\t// extensions\n\t"recommendations": ["a"]\n}'
		const result = JSON.parse(
			init_logic.merge_json_array_field(content, 'recommendations', ['b']),
		) as { recommendations: unknown }

		expect(result.recommendations).toStrictEqual(['a', 'b'])
	})
})

const SIZE_LIMIT_KEY = 'size-limit'
const SIZE_LIMIT_VERSION = '^12.1.0'
const DEV_DEPS_KEY = 'devDependencies'

/* eslint-disable dot-notation -- Record<string, T> requires bracket notation per noPropertyAccessFromIndexSignature */
describe('merge_development_dependencies', () => {
	it('adds missing devDependency', () => {
		const result = JSON.parse(
			init_logic.merge_development_dependencies(`{"${DEV_DEPS_KEY}":{}}`, {
				[SIZE_LIMIT_KEY]: SIZE_LIMIT_VERSION,
			}),
		) as Record<string, Record<string, string>>

		expect(result[DEV_DEPS_KEY]?.[SIZE_LIMIT_KEY]).toBe(SIZE_LIMIT_VERSION)
	})

	it('does not overwrite existing devDependency', () => {
		const result = JSON.parse(
			init_logic.merge_development_dependencies(
				`{"${DEV_DEPS_KEY}":{"${SIZE_LIMIT_KEY}":"^11.0.0"}}`,
				{ [SIZE_LIMIT_KEY]: SIZE_LIMIT_VERSION },
			),
		) as Record<string, Record<string, string>>

		expect(result[DEV_DEPS_KEY]?.[SIZE_LIMIT_KEY]).toBe('^11.0.0')
	})

	it('returns content unchanged when all additions already present', () => {
		const content = `{"${DEV_DEPS_KEY}":{"${SIZE_LIMIT_KEY}":"${SIZE_LIMIT_VERSION}"}}`

		expect(
			init_logic.merge_development_dependencies(content, { [SIZE_LIMIT_KEY]: SIZE_LIMIT_VERSION }),
		).toBe(content)
	})

	it('creates devDependencies key when missing from package json', () => {
		const result = JSON.parse(
			init_logic.merge_development_dependencies('{}', { [SIZE_LIMIT_KEY]: SIZE_LIMIT_VERSION }),
		) as Record<string, Record<string, string>>

		expect(result[DEV_DEPS_KEY]?.[SIZE_LIMIT_KEY]).toBe(SIZE_LIMIT_VERSION)
	})
})

const VISUALIZER_KEY = 'rollup-plugin-visualizer'
const VISUALIZER_VERSION = '^7.0.1'

describe('merge_sveltekit_package_json', () => {
	it('adds size-limit script', () => {
		const result = JSON.parse(init_logic.merge_sveltekit_package_json('{}')) as Record<
			string,
			Record<string, string>
		>

		expect(result['scripts']?.[SIZE_LIMIT_KEY]).toBe(SIZE_LIMIT_KEY)
	})

	it('adds size-limit devDependency', () => {
		const result = JSON.parse(init_logic.merge_sveltekit_package_json('{}')) as Record<
			string,
			Record<string, string>
		>

		expect(result[DEV_DEPS_KEY]?.[SIZE_LIMIT_KEY]).toBe(SIZE_LIMIT_VERSION)
	})

	it('adds size-limit config array', () => {
		const result = JSON.parse(init_logic.merge_sveltekit_package_json('{}')) as Record<
			string,
			Array<Record<string, string>>
		>

		expect(result[SIZE_LIMIT_KEY]).toHaveLength(1)
		expect(result[SIZE_LIMIT_KEY]?.[0]?.['limit']).toBe('500 kB')
	})

	it('does not overwrite existing size-limit devDependency', () => {
		const existing = `{"${DEV_DEPS_KEY}":{"${SIZE_LIMIT_KEY}":"^11.0.0"}}`
		const result = JSON.parse(init_logic.merge_sveltekit_package_json(existing)) as Record<
			string,
			Record<string, string>
		>

		expect(result[DEV_DEPS_KEY]?.[SIZE_LIMIT_KEY]).toBe('^11.0.0')
	})
})

describe('merge_sveltekit_package_json visualizer', () => {
	it('adds rollup-plugin-visualizer devDependency', () => {
		const result = JSON.parse(init_logic.merge_sveltekit_package_json('{}')) as Record<
			string,
			Record<string, string>
		>

		expect(result[DEV_DEPS_KEY]?.[VISUALIZER_KEY]).toBe(VISUALIZER_VERSION)
	})

	it('does not overwrite existing rollup-plugin-visualizer devDependency', () => {
		const existing = `{"${DEV_DEPS_KEY}":{"${VISUALIZER_KEY}":"^6.0.0"}}`
		const result = JSON.parse(init_logic.merge_sveltekit_package_json(existing)) as Record<
			string,
			Record<string, string>
		>

		expect(result[DEV_DEPS_KEY]?.[VISUALIZER_KEY]).toBe('^6.0.0')
	})
})

const STANDARD_VITE_CONFIG = `import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [sveltekit()]
})
`
const STATS_CLIENT = 'stats-client.html'
const STATS_SERVER = 'stats-server.html'

describe('merge_vite_config', () => {
	it('adds visualizer import', () => {
		const result = init_logic.merge_vite_config(STANDARD_VITE_CONFIG)

		expect(result).toContain("import { visualizer } from 'rollup-plugin-visualizer'")
	})

	it('adds UserConfig and ConfigEnv type import', () => {
		const result = init_logic.merge_vite_config(STANDARD_VITE_CONFIG)

		expect(result).toContain("import type { UserConfig, ConfigEnv } from 'vite'")
	})

	it('adds client visualizer entry with stats-client.html', () => {
		const result = init_logic.merge_vite_config(STANDARD_VITE_CONFIG)

		expect(result).toContain(`filename: '${STATS_CLIENT}'`)
		expect(result).toContain("command === 'build' && !config.build?.ssr")
	})

	it('adds server visualizer entry with stats-server.html', () => {
		const result = init_logic.merge_vite_config(STANDARD_VITE_CONFIG)

		expect(result).toContain(`filename: '${STATS_SERVER}'`)
		expect(result).toContain("command === 'build' && !!config.build?.ssr")
	})

	it('is idempotent when visualizer already present', () => {
		const already_merged = init_logic.merge_vite_config(STANDARD_VITE_CONFIG)

		expect(init_logic.merge_vite_config(already_merged)).toBe(already_merged)
	})

	it('returns content unchanged when rollup-plugin-visualizer already imported', () => {
		const content = `import { visualizer } from 'rollup-plugin-visualizer'\n${STANDARD_VITE_CONFIG}`

		expect(init_logic.merge_vite_config(content)).toBe(content)
	})
})

describe('merge_vite_config edge cases', () => {
	it('adds visualizer to empty plugins array', () => {
		const content = `import { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [] })\n`
		const result = init_logic.merge_vite_config(content)

		expect(result).toContain(STATS_CLIENT)
		expect(result).toContain(STATS_SERVER)
	})

	it('handles plugins array with nested brackets', () => {
		const content = `import { sveltekit } from '@sveltejs/kit/vite'\nimport { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [sveltekit(), tailwindcss({ content: ['./src/**/*'] })] })\n`
		const result = init_logic.merge_vite_config(content)

		expect(result).toContain(STATS_CLIENT)
		expect(result).toContain("tailwindcss({ content: ['./src/**/*'] })")
	})

	it('does not inject import when no plugins array found', () => {
		const content = `import { defineConfig } from 'vite'\nexport default defineConfig({})\n`
		const result = init_logic.merge_vite_config(content)

		expect(result).toBe(content)
	})

	it('does not produce double comma when last plugin has inline trailing comma', () => {
		const content = `import { sveltekit } from '@sveltejs/kit/vite'\nimport { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [sveltekit(),] })\n`
		const result = init_logic.merge_vite_config(content)

		expect(result).not.toContain(',,')
		expect(result).toContain(STATS_CLIENT)
	})

	it('does not produce double comma when multiline plugins array has trailing comma', () => {
		const content = `import { sveltekit } from '@sveltejs/kit/vite'\nimport { defineConfig } from 'vite'\nexport default defineConfig({\n\tplugins: [\n\t\tsveltekit(),\n\t]\n})\n`
		const result = init_logic.merge_vite_config(content)

		expect(result).not.toContain(',,')
		expect(result).toContain(STATS_CLIENT)
	})
})
/* eslint-enable dot-notation */

describe('merge_package_scripts', () => {
	const SCRIPT_KEY = 'build'
	const SCRIPT_VAL = 'tsc --noEmit'

	it('adds missing scripts', () => {
		const result = JSON.parse(
			init_logic.merge_package_scripts('{"scripts":{}}', { [SCRIPT_KEY]: SCRIPT_VAL }),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_KEY]).toBe(SCRIPT_VAL)
	})

	it('does not overwrite existing scripts', () => {
		const result = JSON.parse(
			init_logic.merge_package_scripts(`{"scripts":{"${SCRIPT_KEY}":"existing"}}`, {
				[SCRIPT_KEY]: SCRIPT_VAL,
			}),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_KEY]).toBe('existing')
	})

	it('returns content unchanged when all scripts present', () => {
		const content = `{"scripts":{"${SCRIPT_KEY}":"${SCRIPT_VAL}"}}`

		expect(init_logic.merge_package_scripts(content, { [SCRIPT_KEY]: SCRIPT_VAL })).toBe(content)
	})

	it('creates scripts key when missing from package json', () => {
		const result = JSON.parse(
			init_logic.merge_package_scripts('{}', { [SCRIPT_KEY]: SCRIPT_VAL }),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_KEY]).toBe(SCRIPT_VAL)
	})
})

const WORKSPACE_TEMPLATE =
	'onlyBuiltDependencies:\n  - esbuild\n\nminimumReleaseAgeExclude:\n  - vite\n'
const PACKAGES_KEY = 'packages:'
const ONLY_BUILT_KEY = 'onlyBuiltDependencies:'
const KIT_LIST_ENTRY = '  - "@joshuafolkken/kit"'

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
