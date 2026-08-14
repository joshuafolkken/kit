import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { prettier_format_json } from '#scripts/config-merge/prettier-json-fixture'
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

// Verbatim `exclude` of the `.svelte-kit/tsconfig.json` SvelteKit generates, which a consumer
// tsconfig extends. Entries are `../`-prefixed because that file sits inside `.svelte-kit/`.
// Hand-transcribed: `@sveltejs/kit` is not a dependency of kit and adding one to read the real list
// would be a heavy price for a guard. So this pins KIT's side of the contract — it fails when kit
// stops carrying an entry forward, which is the regression #796 was — and not SvelteKit's; a future
// SvelteKit release that adds an exclusion needs this list updated by hand to stay meaningful.
const SVELTE_KIT_GENERATED_EXCLUDE: ReadonlyArray<string> = [
	'../node_modules/**',
	'../src/service-worker.js',
	'../src/service-worker/**/*.js',
	'../src/service-worker.ts',
	'../src/service-worker/**/*.ts',
	'../src/service-worker.d.ts',
	'../src/service-worker/**/*.d.ts',
]

const PARENT_PREFIX = '../'

// `node_modules` (a bare directory name) excludes everything beneath it, so it stands in for the
// `node_modules/**` glob the generated config spells out — the one entry kit does not repeat.
const NODE_MODULES_GLOB = 'node_modules/**'

// Rewrite a generated-config entry to the form a consumer-root tsconfig would spell it.
function to_root_relative(entry: string): string {
	const stripped = entry.startsWith(PARENT_PREFIX) ? entry.slice(PARENT_PREFIX.length) : entry

	return stripped === NODE_MODULES_GLOB ? NODE_MODULES_DIR : stripped
}

function root_relative_sveltekit_exclude(): Array<string> {
	return SVELTE_KIT_GENERATED_EXCLUDE.map((entry) => to_root_relative(entry))
}

function generated_exclude_entries(): Array<string> {
	return (JSON.parse(init_logic.generate_tsconfig()) as { exclude: Array<string> }).exclude
}

describe('generate_tsconfig', () => {
	it('includes only our config as direct preset path', () => {
		const result = init_logic.generate_tsconfig()

		expect(result).toContain('node_modules/@joshuafolkken/kit/tsconfig/base.json')
		expect(result).not.toContain('.svelte-kit')
	})

	// The html reporter writes playwright-report/ and Playwright writes test-results/; both hold
	// generated output a consumer's broad `include` would otherwise type-check (#712).
	it('excludes the directories the kit-distributed configs generate', () => {
		const written = generated_exclude_entries()

		expect(written).toContain(PLAYWRIGHT_REPORT_DIR)
		expect(written).toContain(TEST_RESULTS_DIR)
	})

	// A consumer `exclude` REPLACES the extended `.svelte-kit/tsconfig.json` array rather than merging
	// with it, so every entry the generated config contributes has to survive in the array kit writes.
	// Before #796 all six service-worker globs were silently dropped.
	it('carries every exclude entry of the generated SvelteKit config forward', () => {
		const written = generated_exclude_entries()

		expect(written).toStrictEqual(expect.arrayContaining(root_relative_sveltekit_exclude()))
	})

	// A multi-line `exclude` failed `prettier --check` in the consumer once (#660). Assert the intent
	// directly — the written file is a prettier fixed point — rather than a shape the entry count
	// happens to produce, so growing the array cannot quietly reintroduce the regression.
	it('writes a file real prettier leaves unchanged', async () => {
		const generated = init_logic.generate_tsconfig()

		expect(await prettier_format_json(generated)).toBe(generated)
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

	// The installed base is the point: every current consumer already owns a tsconfig, so the
	// service-worker globs have to arrive by merge, not only in a freshly generated file (#796).
	it('appends the generated SvelteKit exclusions to an existing consumer exclude', () => {
		const result = merge_exclude_entries({ exclude: [NODE_MODULES_DIR, CONSUMER_ONLY_EXCLUDE] })

		expect(result).toStrictEqual(expect.arrayContaining(root_relative_sveltekit_exclude()))
		expect(result).toContain(CONSUMER_ONLY_EXCLUDE)
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
