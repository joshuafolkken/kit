import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { build_library, library_paths } from './build-library'

const LIBRARY = 'version'
const { outfile: VERSION_OUTFILE, dts_file: VERSION_DTS_FILE } = library_paths(LIBRARY)
const BUILD_TIMEOUT = 60_000
const RUNTIME_EXPORTS: ReadonlyArray<string> = [
	'KIT_PACKAGE_NAME',
	'create_version_command_config',
	'derive_versions_endpoint',
	'kit_package_descriptor',
	'resolve_effective_upstream_version',
	'version_commands',
]

beforeAll(async () => {
	await build_library(LIBRARY)
}, BUILD_TIMEOUT)

describe('build_library version — compiled .js', () => {
	it('writes the bundled library to dist/version/index.js', () => {
		expect(existsSync(VERSION_OUTFILE)).toBe(true)
	})

	it('inlines kit internal #scripts/* graph (no unresolvable subpath imports remain)', () => {
		const content = readFileSync(VERSION_OUTFILE, 'utf8')

		expect(content).not.toContain('#scripts/')
	})

	it('keeps runtime deps external so consumers resolve them from kit node_modules', () => {
		const content = readFileSync(VERSION_OUTFILE, 'utf8')

		expect(content).toContain('from "execa"')
		expect(content).toContain('from "zod"')
	})

	// The built file is what a consumer loads, so a name dropped from the barrel fails here even when
	// nothing inside kit imports it — app-kit's `upstreams: [kit_package_descriptor]` would not.
	it('loads under plain node and exports every runtime name of the barrel', () => {
		const module_url = pathToFileURL(VERSION_OUTFILE).href
		const script = `import('${module_url}').then((m) => console.log(JSON.stringify(Object.keys(m))))`
		const result = spawnSync('node', ['--input-type=module', '-e', script], {
			encoding: 'utf8',
		})
		const names = z.array(z.string()).parse(JSON.parse(result.stdout))

		expect(new Set(names)).toEqual(new Set(RUNTIME_EXPORTS))
	})
})

describe('build_library version — bundled .d.ts', () => {
	it('writes a declaration file to dist/version/index.d.ts', () => {
		expect(existsSync(VERSION_DTS_FILE)).toBe(true)
	})

	it('is self-contained with no #scripts/* import a consumer cannot resolve', () => {
		const content = readFileSync(VERSION_DTS_FILE, 'utf8')

		expect(content).not.toContain('#scripts/')
	})

	it('re-exports the public API surface', () => {
		const content = readFileSync(VERSION_DTS_FILE, 'utf8')

		expect(content).toContain('create_version_command_config')
		expect(content).toContain('version_commands')
	})
})
