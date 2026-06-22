import { describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

const TSCONFIG_BASE = '@joshuafolkken/kit/tsconfig/base.json'
const EXCLUDE_KEY = 'exclude'
const NODE_MODULES_VALUE = 'node_modules'
const SVELTE_KIT_VALUE = '.svelte-kit'
const DEV_DEP_KEY = '@joshuafolkken/kit'
const DEV_DEP_VERSION = '^0.1.0'
const SCRIPT_DEV = 'dev'
const SCRIPT_DEV_VALUE = 'vite dev'
const SCRIPT_BUILD = 'build'
const DEV_DEPS_KEY = 'devDependencies'

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

	it('preserves scripts key position when other keys precede it', () => {
		const input = JSON.stringify({ name: 'app', version: '1.0.0', scripts: { existing: 'cmd' } })
		const result = JSON.parse(
			init_logic_json_merge.merge_package_scripts(input, { [SCRIPT_DEV]: SCRIPT_DEV_VALUE }),
		) as object
		const keys = Object.keys(result)

		expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('scripts'))
		expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('scripts'))
	})
})

const POSTINSTALL_KEY = 'postinstall'
const LEFTHOOK_CMD = 'lefthook install'
const FIX_GH_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'

describe('init_logic_json_merge.merge_package_script_suffix - append', () => {
	it('appends cmd to existing script when cmd is absent', () => {
		const content = JSON.stringify({ scripts: { [POSTINSTALL_KEY]: LEFTHOOK_CMD } })
		const result = JSON.parse(
			init_logic_json_merge.merge_package_script_suffix(content, POSTINSTALL_KEY, FIX_GH_CMD),
		) as { scripts: Record<string, string> }

		expect(result.scripts[POSTINSTALL_KEY]).toBe(`${LEFTHOOK_CMD} && ${FIX_GH_CMD}`)
	})

	it('sets cmd as the full value when existing script is empty string', () => {
		const content = JSON.stringify({ scripts: { [POSTINSTALL_KEY]: '' } })
		const result = JSON.parse(
			init_logic_json_merge.merge_package_script_suffix(content, POSTINSTALL_KEY, FIX_GH_CMD),
		) as { scripts: Record<string, string> }

		expect(result.scripts[POSTINSTALL_KEY]).toBe(FIX_GH_CMD)
	})
})

describe('init_logic_json_merge.merge_package_script_suffix - guards', () => {
	it('returns content unchanged when cmd already present', () => {
		const content = JSON.stringify({
			scripts: { [POSTINSTALL_KEY]: `${LEFTHOOK_CMD} && ${FIX_GH_CMD}` },
		})

		expect(
			init_logic_json_merge.merge_package_script_suffix(content, POSTINSTALL_KEY, FIX_GH_CMD),
		).toBe(content)
	})

	it('returns content unchanged when key is absent', () => {
		const content = JSON.stringify({ scripts: {} })

		expect(
			init_logic_json_merge.merge_package_script_suffix(content, POSTINSTALL_KEY, FIX_GH_CMD),
		).toBe(content)
	})

	it('returns content unchanged when scripts block is absent', () => {
		const content = '{}'

		expect(
			init_logic_json_merge.merge_package_script_suffix(content, POSTINSTALL_KEY, FIX_GH_CMD),
		).toBe(content)
	})
})

describe('init_logic_json_merge.has_package_scripts_marker', () => {
	const MARKER = 'fix-gh-packages'

	it('returns true when a script value contains the marker', () => {
		const content = JSON.stringify({ scripts: { prepare: `command -v tsx && ${FIX_GH_CMD}` } })

		expect(init_logic_json_merge.has_package_scripts_marker(content, MARKER)).toBe(true)
	})

	it('returns false when no script value contains the marker', () => {
		const content = JSON.stringify({ scripts: { [POSTINSTALL_KEY]: LEFTHOOK_CMD } })

		expect(init_logic_json_merge.has_package_scripts_marker(content, MARKER)).toBe(false)
	})

	it('returns false when the scripts block is absent', () => {
		expect(init_logic_json_merge.has_package_scripts_marker('{}', MARKER)).toBe(false)
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

	it('preserves devDependencies key position when other keys precede it', () => {
		const input = JSON.stringify({
			name: 'app',
			version: '1.0.0',
			devDependencies: { existing: '^1.0.0' },
		})
		const result = JSON.parse(
			init_logic_json_merge.merge_development_dependencies(input, {
				[DEV_DEP_KEY]: DEV_DEP_VERSION,
			}),
		) as object
		const keys = Object.keys(result)

		expect(keys.indexOf('name')).toBeLessThan(keys.indexOf(DEV_DEPS_KEY))
		expect(keys.indexOf('version')).toBeLessThan(keys.indexOf(DEV_DEPS_KEY))
	})
})

const DEV_ENGINES_KEY = 'devEngines'
const DEV_ENGINES_VALUE = {
	packageManager: { name: 'pnpm', version: '>=11.0.0-0', onFail: 'error' },
}

describe('init_logic_json_merge.merge_development_engines', () => {
	it('adds devEngines when absent', () => {
		const result = JSON.parse(
			init_logic_json_merge.merge_development_engines('{"name":"app"}', DEV_ENGINES_VALUE),
		) as Record<string, unknown>

		expect(result[DEV_ENGINES_KEY]).toStrictEqual(DEV_ENGINES_VALUE)
	})

	it('returns content unchanged when devEngines already present', () => {
		const content = JSON.stringify({ name: 'app', devEngines: { packageManager: { name: 'npm' } } })

		expect(init_logic_json_merge.merge_development_engines(content, DEV_ENGINES_VALUE)).toBe(
			content,
		)
	})
})

const NORMALIZE_NAME = 'my-app'
const NORMALIZE_VERSION = '1.0.0'

describe('init_logic_json_merge.sort_package_json_keys', () => {
	it('places name before devDependencies when devDependencies was first', () => {
		const input = JSON.stringify({
			devDependencies: { foo: '^1.0.0' },
			name: NORMALIZE_NAME,
			version: NORMALIZE_VERSION,
		})
		const result = JSON.parse(init_logic_json_merge.sort_package_json_keys(input)) as object
		const keys = Object.keys(result)

		expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('devDependencies'))
		expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('devDependencies'))
	})

	it('places scripts before devDependencies', () => {
		const input = JSON.stringify({ devDependencies: {}, scripts: {}, name: NORMALIZE_NAME })
		const keys = Object.keys(
			JSON.parse(init_logic_json_merge.sort_package_json_keys(input)) as object,
		)

		expect(keys.indexOf('scripts')).toBeLessThan(keys.indexOf('devDependencies'))
	})

	it('places dependencies before devDependencies', () => {
		const input = JSON.stringify({ devDependencies: {}, dependencies: {}, name: NORMALIZE_NAME })
		const keys = Object.keys(
			JSON.parse(init_logic_json_merge.sort_package_json_keys(input)) as object,
		)

		expect(keys.indexOf('dependencies')).toBeLessThan(keys.indexOf('devDependencies'))
	})
})

describe('init_logic_json_merge.sort_package_json_keys (devEngines ordering)', () => {
	it('places packageManager before engines', () => {
		const input = JSON.stringify({
			engines: {},
			packageManager: 'pnpm@10.0.0',
			name: NORMALIZE_NAME,
		})
		const keys = Object.keys(
			JSON.parse(init_logic_json_merge.sort_package_json_keys(input)) as object,
		)

		expect(keys.indexOf('packageManager')).toBeLessThan(keys.indexOf('engines'))
	})

	it('places devEngines after engines', () => {
		const input = JSON.stringify({ devEngines: {}, engines: {}, name: NORMALIZE_NAME })
		const keys = Object.keys(
			JSON.parse(init_logic_json_merge.sort_package_json_keys(input)) as object,
		)

		expect(keys.indexOf('engines')).toBeLessThan(keys.indexOf('devEngines'))
	})
})

describe('init_logic_json_merge.sort_package_json_keys (edge cases)', () => {
	it('places unknown keys after all known keys', () => {
		const input = JSON.stringify({ 'custom-field': 'value', name: NORMALIZE_NAME })
		const result = JSON.parse(init_logic_json_merge.sort_package_json_keys(input)) as object
		const keys = Object.keys(result)

		expect(keys[0]).toBe('name')
		expect(keys.at(-1)).toBe('custom-field')
	})

	it('returns original content when order is already correct', () => {
		const ordered = `${JSON.stringify({ name: NORMALIZE_NAME, devDependencies: {} }, undefined, '\t')}\n`

		expect(init_logic_json_merge.sort_package_json_keys(ordered)).toBe(ordered)
	})
})
