import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'
import { PACKAGE_DIR } from './init-paths'

const VANILLA_PRESET = './node_modules/@joshuafolkken/kit/tsconfig/base.json'
const JSON_EXTENSION = '.json'
const TSCONFIG_PRESET_DIR = 'tsconfig'

const TSCONFIG_BASE_SUBPATH = './tsconfig/base'

function read_tsconfig_base_export(): string | undefined {
	const parsed = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
		exports: Record<string, { default: string } | undefined>
	}

	return parsed.exports[TSCONFIG_BASE_SUBPATH]?.default
}

describe('generate_tsconfig', () => {
	it('includes only our config as direct preset path', () => {
		const result = init_logic.generate_tsconfig()

		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/base.json')
		expect(result).not.toContain('.svelte-kit')
	})
})

describe('get_tsconfig_extends_entry', () => {
	it('returns direct node_modules preset path', () => {
		expect(init_logic.get_tsconfig_extends_entry()).toBe(VANILLA_PRESET)
	})
})

// Playwright >= 1.62 appends `.json` to any `extends` entry that does not already end in it, then
// throws when the resulting path is missing — a `.jsonc` preset resolved to `*.jsonc.json` and took
// down the entire E2E suite before a single test ran. These guards fail the moment the preset drifts
// back to another extension or the shipped file stops matching the advertised name (#681).
describe('tsconfig preset extension — Playwright extends resolution guard (#681)', () => {
	it('advertises an extends entry ending in .json', () => {
		expect(init_logic.get_tsconfig_extends_entry().endsWith(JSON_EXTENSION)).toBe(true)
	})

	it('names a preset file ending in .json', () => {
		expect(init_logic.get_tsconfig_preset_filename().endsWith(JSON_EXTENSION)).toBe(true)
	})

	it('ships the named preset file inside the package tsconfig directory', () => {
		const filename = init_logic.get_tsconfig_preset_filename()

		expect(existsSync(path.join(PACKAGE_DIR, TSCONFIG_PRESET_DIR, filename))).toBe(true)
	})

	it('points the package.json exports subpath at the same shipped preset', () => {
		const expected = `./${TSCONFIG_PRESET_DIR}/${init_logic.get_tsconfig_preset_filename()}`

		expect(read_tsconfig_base_export()).toBe(expected)
	})
})
