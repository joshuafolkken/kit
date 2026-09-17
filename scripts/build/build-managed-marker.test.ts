import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	build_managed_marker_library,
	MANAGED_MARKER_DTS_FILE,
	MANAGED_MARKER_OUTFILE,
} from './build-managed-marker'

// The stamp is a public surface, not an internal detail: a package built on kit distributes its own
// workflows and has to write the same header kit writes, or the auto-merge check that reads it
// cannot recognize them (joshuafolkken/kit#844). That only works if the module actually ships and
// loads from a consumer, which is what these assertions hold — the same guarantees the sibling
// `config-merge` and `version` libraries are held to.
const BUILD_TIMEOUT = 60_000

beforeAll(async () => {
	await build_managed_marker_library()
}, BUILD_TIMEOUT)

describe('build_managed_marker_library — compiled .js', () => {
	it('writes the bundled library to dist/managed-marker/index.js', () => {
		expect(existsSync(MANAGED_MARKER_OUTFILE)).toBe(true)
	})

	it('inlines kit internal #scripts/* graph (no unresolvable subpath imports remain)', () => {
		expect(readFileSync(MANAGED_MARKER_OUTFILE, 'utf8')).not.toContain('#scripts/')
	})

	// The point of the export: a downstream distributor stamps with its own name. Exercised through
	// the built artifact rather than the source, because that is the copy a consumer loads.
	it('stamps a downstream distributor’s workflow under plain node', () => {
		const module_url = pathToFileURL(MANAGED_MARKER_OUTFILE).href
		const body = String.raw`'name: DAST\n'`
		const script = `import('${module_url}').then((m) => {
			const written = m.managed_marker_logic.apply_marker_for_destination(
				'.github/workflows/dast.yml', ${body}, '@example/downstream')
			const ok = written.startsWith('# josh-managed-workflow: @example/downstream')
				&& m.managed_marker_logic.is_marked(written)
			if (!ok) process.exit(1)
		})`
		const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })

		expect(result.status).toBe(0)
	})
})

describe('build_managed_marker_library — bundled .d.ts', () => {
	it('writes a declaration file to dist/managed-marker/index.d.ts', () => {
		expect(existsSync(MANAGED_MARKER_DTS_FILE)).toBe(true)
	})

	it('is self-contained with no #scripts/* import a consumer cannot resolve', () => {
		expect(readFileSync(MANAGED_MARKER_DTS_FILE, 'utf8')).not.toContain('#scripts/')
	})

	it('re-exports the public API surface', () => {
		const content = readFileSync(MANAGED_MARKER_DTS_FILE, 'utf8')

		expect(content).toContain('managed_marker_logic')
		expect(content).toContain('apply_marker_for_destination')
	})
})
