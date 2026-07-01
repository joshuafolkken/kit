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

const PACKAGE_MANAGER_VALUE = 'pnpm@10.0.0'
const PKG_WITH_NAME = '{"name":"my-app"}'

describe('merge_package_manager', () => {
	it('adds packageManager field when missing', () => {
		const result = JSON.parse(
			init_logic.merge_package_manager('{}', PACKAGE_MANAGER_VALUE),
		) as Record<string, string>

		expect(result['packageManager']).toBe(PACKAGE_MANAGER_VALUE)
	})

	it('returns content unchanged when packageManager already set', () => {
		const content = `{"packageManager":"${PACKAGE_MANAGER_VALUE}"}`

		expect(init_logic.merge_package_manager(content, 'pnpm@99.0.0')).toBe(content)
	})

	it('does not overwrite different existing packageManager value', () => {
		const existing = `{"packageManager":"pnpm@9.0.0"}`
		const result = JSON.parse(
			init_logic.merge_package_manager(existing, PACKAGE_MANAGER_VALUE),
		) as Record<string, string>

		expect(result['packageManager']).toBe('pnpm@9.0.0')
	})

	it('preserves other fields when adding packageManager', () => {
		const result = JSON.parse(
			init_logic.merge_package_manager(PKG_WITH_NAME, PACKAGE_MANAGER_VALUE),
		) as Record<string, string>

		expect(result['name']).toBe('my-app')
		expect(result['packageManager']).toBe(PACKAGE_MANAGER_VALUE)
	})

	it('returns content unchanged when value is empty string', () => {
		const content = PKG_WITH_NAME

		expect(init_logic.merge_package_manager(content, '')).toBe(content)
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
