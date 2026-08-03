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

const NODE_MODULES_DIR = 'node_modules'
const PLAYWRIGHT_REPORT_DIR = 'playwright-report'
const TEST_RESULTS_DIR = 'test-results'
const CONSUMER_ONLY_EXCLUDE = 'legacy-vendor'

describe('generate_tsconfig', () => {
	it('includes only our config as direct preset path', () => {
		const result = init_logic.generate_tsconfig()

		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/base.json')
		expect(result).not.toContain('.svelte-kit')
	})

	// The html reporter writes playwright-report/ and Playwright writes test-results/; both hold
	// generated output a consumer's broad `include` would otherwise type-check (#712).
	it('excludes the directories the kit-distributed configs generate', () => {
		const parsed = JSON.parse(init_logic.generate_tsconfig()) as { exclude: Array<string> }

		expect(parsed.exclude).toContain(PLAYWRIGHT_REPORT_DIR)
		expect(parsed.exclude).toContain(TEST_RESULTS_DIR)
	})

	it('keeps the exclude array on one line so the generated file is prettier-clean', () => {
		expect(init_logic.generate_tsconfig()).toContain(`"exclude": ["${NODE_MODULES_DIR}"`)
	})
})

function merge_exclude_entries(existing: unknown): Array<string> {
	const merged = init_logic.merge_tsconfig_exclude(`${JSON.stringify(existing)}\n`)

	return (JSON.parse(merged) as { exclude?: Array<string> }).exclude ?? []
}

describe('merge_tsconfig_exclude', () => {
	it('adds the generated-output directories to a tsconfig that has no exclude', () => {
		const result = merge_exclude_entries({ extends: [VANILLA_PRESET] })

		expect(result).toStrictEqual([...init_logic.get_tsconfig_exclude_entries()])
	})

	it('appends only the missing entries to an existing exclude', () => {
		const result = merge_exclude_entries({ exclude: [NODE_MODULES_DIR] })

		expect(result[0]).toBe(NODE_MODULES_DIR)
		expect(result).toContain(PLAYWRIGHT_REPORT_DIR)
	})

	it('preserves an entry kit does not own', () => {
		const result = merge_exclude_entries({ exclude: [CONSUMER_ONLY_EXCLUDE] })

		expect(result).toContain(CONSUMER_ONLY_EXCLUDE)
		expect(result).toContain(TEST_RESULTS_DIR)
	})

	it('is a no-op on an already-merged file', () => {
		const merged = init_logic.merge_tsconfig_exclude(init_logic.generate_tsconfig())

		expect(merged).toBe(init_logic.generate_tsconfig())
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
