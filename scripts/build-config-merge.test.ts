import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	build_config_merge_library,
	CONFIG_MERGE_DTS_FILE,
	CONFIG_MERGE_OUTFILE,
} from './build-config-merge'

const BUILD_TIMEOUT = 60_000

beforeAll(async () => {
	await build_config_merge_library()
}, BUILD_TIMEOUT)

describe('build_config_merge_library — compiled .js', () => {
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

	it('loads under plain node and exposes the public API', () => {
		const module_url = pathToFileURL(CONFIG_MERGE_OUTFILE).href
		const script = `import('${module_url}').then((m) => { if (typeof m.config_merge !== 'object' || typeof m.config_merge.patch_yaml_list_field !== 'function') process.exit(1) })`
		const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })

		expect(result.status).toBe(0)
	})
})

describe('build_config_merge_library — bundled .d.ts', () => {
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
