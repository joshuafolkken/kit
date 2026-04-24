import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

const TSCONFIG_BASE = '@joshuafolkken/kit/tsconfig/base.json'
const EXCLUDE_KEY = 'exclude'
const NODE_MODULES_VALUE = 'node_modules'
const SVELTE_KIT_VALUE = '.svelte-kit'
const CSPELL_PATH = '@joshuafolkken/kit/cspell'
const DEV_DEP_KEY = '@joshuafolkken/kit'
const DEV_DEP_VERSION = '^0.1.0'
const SCRIPT_DEV = 'dev'
const SCRIPT_DEV_VALUE = 'vite dev'
const SCRIPT_BUILD = 'build'
const DEV_DEPS_KEY = 'devDependencies'
const EXCLUDE_YAML_CONTENT = `${EXCLUDE_KEY}:\n  - ${NODE_MODULES_VALUE}\n`

describe('init_logic_json_merge.merge_json_extends', () => {
	it('prepends entry to empty extends array', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_json_extends('{"extends":[]}', TSCONFIG_BASE),
		) as { extends: Array<string> }

		expect(result.extends).toStrictEqual([TSCONFIG_BASE])
	})

	it('normalizes string extends to array and prepends entry', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_json_extends('{"extends":"other"}', TSCONFIG_BASE),
		) as { extends: Array<string> }

		expect(result.extends).toStrictEqual([TSCONFIG_BASE, 'other'])
	})

	it('returns content unchanged when entry already present', () => {
		const content = `{"extends":["${TSCONFIG_BASE}"]}`

		expect(init_logic_json_merge.merge_json_extends(content, TSCONFIG_BASE)).toBe(content)
	})
})

describe('init_logic_json_merge.merge_json_array_field', () => {
	it('appends missing values to existing array', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_json_array_field(
				`{"${EXCLUDE_KEY}":["${NODE_MODULES_VALUE}"]}`,
				EXCLUDE_KEY,
				[SVELTE_KIT_VALUE],
			),
		) as { exclude: Array<string> }

		expect(result.exclude).toContain(SVELTE_KIT_VALUE)
	})

	it('returns content unchanged when all values already present', () => {
		const content = `{"${EXCLUDE_KEY}":["${NODE_MODULES_VALUE}"]}`

		expect(
			init_logic_json_merge.merge_json_array_field(content, EXCLUDE_KEY, [NODE_MODULES_VALUE]),
		).toBe(content)
	})
})

describe('init_logic_json_merge.merge_json_object', () => {
	it('adds missing key from updates', () => {
		const result = JSON.parse(init_logic_json_merge.merge_json_object('{"a":1}', { b: 2 })) as {
			a: number
			b: number
		}

		expect(result.b).toBe(2)
	})

	it('returns content unchanged when key already present', () => {
		const content = '{"a":1}'

		expect(init_logic_json_merge.merge_json_object(content, { a: 99 })).toBe(content)
	})
})

describe('init_logic_json_merge.merge_yaml_list_entry', () => {
	it('adds value to existing YAML list', () => {
		const result = init_logic_json_merge.merge_yaml_list_entry(
			EXCLUDE_YAML_CONTENT,
			EXCLUDE_KEY,
			SVELTE_KIT_VALUE,
		)

		expect(result).toContain(SVELTE_KIT_VALUE)
	})

	it('returns content unchanged when value already present', () => {
		expect(
			init_logic_json_merge.merge_yaml_list_entry(
				EXCLUDE_YAML_CONTENT,
				EXCLUDE_KEY,
				NODE_MODULES_VALUE,
			),
		).toBe(EXCLUDE_YAML_CONTENT)
	})

	it('creates key with value when key is absent', () => {
		const result = init_logic_json_merge.merge_yaml_list_entry('', EXCLUDE_KEY, NODE_MODULES_VALUE)

		expect(result).toContain(EXCLUDE_KEY)
		expect(result).toContain(NODE_MODULES_VALUE)
	})
})

describe('init_logic_json_merge.merge_cspell_import', () => {
	it('inserts import after version when key is absent', () => {
		const result = init_logic_json_merge.merge_cspell_import("version: '0.2'\n", CSPELL_PATH)

		expect(result).toContain(CSPELL_PATH)
	})

	it('returns content unchanged when import already present', () => {
		const content = `import:\n  - '${CSPELL_PATH}'\n`

		expect(init_logic_json_merge.merge_cspell_import(content, CSPELL_PATH)).toBe(content)
	})
})

describe('init_logic_json_merge.merge_package_scripts', () => {
	it('adds missing script', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_package_scripts('{"scripts":{}}', {
				[SCRIPT_DEV]: SCRIPT_DEV_VALUE,
			}),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_DEV]).toBe(SCRIPT_DEV_VALUE)
	})

	it('returns content unchanged when script present and no migrations needed', () => {
		const content = `{"scripts":{"${SCRIPT_DEV}":"${SCRIPT_DEV_VALUE}"}}`

		expect(init_logic_json_merge.merge_package_scripts(content, {})).toBe(content)
	})

	it('migrates jf- prefixed script values to josh prefix', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_package_scripts(`{"scripts":{"${SCRIPT_BUILD}":"jf-build"}}`, {}),
		) as { scripts: Record<string, string> }

		expect(result.scripts[SCRIPT_BUILD]).toBe('josh build')
	})
})

describe('init_logic_json_merge.merge_development_dependencies', () => {
	it('adds missing devDependency', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_development_dependencies('{"devDependencies":{}}', {
				[DEV_DEP_KEY]: DEV_DEP_VERSION,
			}),
		) as Record<string, Record<string, string>>

		expect(result[DEV_DEPS_KEY]?.[DEV_DEP_KEY]).toBe(DEV_DEP_VERSION)
	})

	it('returns content unchanged when devDependency already present', () => {
		const content = `{"devDependencies":{"${DEV_DEP_KEY}":"${DEV_DEP_VERSION}"}}`

		expect(
			init_logic_json_merge.merge_development_dependencies(content, { [DEV_DEP_KEY]: '^0.2.0' }),
		).toBe(content)
	})
})
