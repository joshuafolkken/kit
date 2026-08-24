import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { managed_marker_logic } from './index'

const marker_export_schema = z.object({ types: z.string(), default: z.string() })
const exports_schema = z.object({
	exports: z.record(z.string(), z.unknown()),
	scripts: z.record(z.string(), z.string()),
})

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SELF_DIR, '..', '..')
const EXPORT_KEY = './managed-marker'
const EXPORT_TYPES = './dist/managed-marker/index.d.ts'
const EXPORT_DEFAULT = './dist/managed-marker/index.js'
const BUILD_STEP = 'tsx scripts/build-managed-marker.ts'

function read_manifest(): z.infer<typeof exports_schema> {
	const raw = readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')

	return exports_schema.parse(JSON.parse(raw))
}

describe('managed-marker library barrel', () => {
	it('re-exports the stamp helpers a downstream distributor needs', () => {
		expect(typeof managed_marker_logic.apply_marker_for_destination).toBe('function')
		expect(typeof managed_marker_logic.is_marked).toBe('function')
		expect(typeof managed_marker_logic.MARKER_PREFIX).toBe('string')
	})
})

describe('package.json managed-marker export', () => {
	it('exposes ./managed-marker pointing at the compiled dist output', () => {
		const marker_export = marker_export_schema.parse(read_manifest().exports[EXPORT_KEY])

		expect(marker_export.types).toBe(EXPORT_TYPES)
		expect(marker_export.default).toBe(EXPORT_DEFAULT)
	})

	// `dist/` is gitignored and `publish.yml` installs with `--ignore-scripts`, so the tarball only
	// carries this library if `prepack` builds it. Without that the export resolves to a file that
	// was never written, and the downstream import this whole mechanism exists for throws
	// ERR_MODULE_NOT_FOUND (joshuafolkken/kit#844).
	it.each(['build', 'prepack'])('builds the library in the %s script', (script) => {
		expect(read_manifest().scripts[script]).toContain(BUILD_STEP)
	})
})
