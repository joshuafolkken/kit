import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_version_library, VERSION_DTS_FILE, VERSION_OUTFILE } from './build-version'

const BUILD_TIMEOUT = 60_000

beforeAll(async () => {
	await build_version_library()
}, BUILD_TIMEOUT)

describe('build_version_library — compiled .js', () => {
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

	it('loads under plain node and exposes the public API', () => {
		const module_url = pathToFileURL(VERSION_OUTFILE).href
		const script = `import('${module_url}').then((m) => { if (typeof m.create_version_command_config !== 'function' || typeof m.version_commands !== 'object') process.exit(1) })`
		const result = spawnSync('node', ['--input-type=module', '-e', script], {
			encoding: 'utf8',
		})

		expect(result.status).toBe(0)
	})
})

describe('build_version_library — bundled .d.ts', () => {
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
