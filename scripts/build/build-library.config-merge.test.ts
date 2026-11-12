import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { build_library, library_paths } from './build-library'

const LIBRARY = 'config-merge'
const { outfile: CONFIG_MERGE_OUTFILE, dts_file: CONFIG_MERGE_DTS_FILE } = library_paths(LIBRARY)
const BUILD_TIMEOUT = 60_000
const CONFIG_MERGE_FUNCTIONS: ReadonlyArray<string> = [
	'patch_json_list_field',
	'patch_yaml_list_field',
	'read_yaml_list_field',
]

beforeAll(async () => {
	await build_library(LIBRARY)
}, BUILD_TIMEOUT)

describe('build_library config_merge — compiled .js', () => {
	it('writes the bundled library to dist/config-merge/index.js', () => {
		expect(existsSync(CONFIG_MERGE_OUTFILE)).toBe(true)
	})

	it('inlines kit internal #scripts/* graph (no unresolvable subpath imports remain)', () => {
		const content = readFileSync(CONFIG_MERGE_OUTFILE, 'utf8')

		expect(content).not.toContain('#scripts/')
	})

	it('keeps runtime deps external so consumers resolve them from kit node_modules', () => {
		const content = readFileSync(CONFIG_MERGE_OUTFILE, 'utf8')

		expect(content).toContain('from "js-yaml"')
		expect(content).toContain('from "zod"')
	})

	// The built file is what a consumer loads, so a function dropped from `config_merge` fails here
	// even when nothing inside kit calls it through the barrel.
	it('loads under plain node and exposes every config_merge function', () => {
		const module_url = pathToFileURL(CONFIG_MERGE_OUTFILE).href
		const script = `import('${module_url}').then((m) => console.log(JSON.stringify(Object.keys(m.config_merge))))`
		const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })
		const names = z.array(z.string()).parse(JSON.parse(result.stdout))

		expect(new Set(names)).toEqual(new Set(CONFIG_MERGE_FUNCTIONS))
	})
})

describe('build_library config_merge — bundled .d.ts', () => {
	it('writes a declaration file to dist/config-merge/index.d.ts', () => {
		expect(existsSync(CONFIG_MERGE_DTS_FILE)).toBe(true)
	})

	it('is self-contained with no #scripts/* import a consumer cannot resolve', () => {
		const content = readFileSync(CONFIG_MERGE_DTS_FILE, 'utf8')

		expect(content).not.toContain('#scripts/')
	})

	it('re-exports the public API surface', () => {
		const content = readFileSync(CONFIG_MERGE_DTS_FILE, 'utf8')

		expect(content).toContain('config_merge')
		expect(content).toContain('patch_yaml_list_field')
	})
})
