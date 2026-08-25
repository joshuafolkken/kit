import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	build_self_sync_guard_library,
	SELF_SYNC_GUARD_DTS_FILE,
	SELF_SYNC_GUARD_OUTFILE,
} from './build-self-sync-guard'

// The guard is a public surface, not an internal detail: app-kit and game-kit run the same kind of
// copy and have to refuse a sync aimed at their own repository the same way kit does
// (joshuafolkken/kit#868). That only works if the module actually ships and loads from a consumer,
// which is what these assertions hold — the same guarantees the sibling `managed-marker`,
// `config-merge` and `version` libraries are held to.
const BUILD_TIMEOUT = 60_000
const DOWNSTREAM_NAME = '@example/downstream'
const MANIFEST = 'package.json'

beforeAll(async () => {
	await build_self_sync_guard_library()
}, BUILD_TIMEOUT)

function manifest_directory(name: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'guard-dist-'))

	writeFileSync(path.join(directory, MANIFEST), JSON.stringify({ name }))

	return directory
}

describe('build_self_sync_guard_library — compiled .js', () => {
	it('writes the bundled library to dist/self-sync-guard/index.js', () => {
		expect(existsSync(SELF_SYNC_GUARD_OUTFILE)).toBe(true)
	})

	it('inlines kit internal #scripts/* graph (no unresolvable subpath imports remain)', () => {
		expect(readFileSync(SELF_SYNC_GUARD_OUTFILE, 'utf8')).not.toContain('#scripts/')
	})

	// The point of the export: a downstream distributor detects ITS own repository, under its own
	// name. Exercised through the built artifact rather than the source, because that is the copy a
	// consumer loads.
	it('refuses a downstream distributor’s own repository under plain node', () => {
		const module_url = pathToFileURL(SELF_SYNC_GUARD_OUTFILE).href
		const own = manifest_directory(DOWNSTREAM_NAME)
		const consumer = manifest_directory('@example/consumer')
		const script = `import('${module_url}').then((m) => {
			const refused = m.self_sync_guard.self_sync_reason(${JSON.stringify(own)}, ${JSON.stringify(own)})
			const allowed = m.self_sync_guard.self_sync_reason(${JSON.stringify(own)}, ${JSON.stringify(consumer)})
			if (refused === undefined || allowed !== undefined) process.exit(1)
		})`
		const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })

		expect(result.status).toBe(0)
	})
})

describe('build_self_sync_guard_library — bundled .d.ts', () => {
	it('writes a declaration file to dist/self-sync-guard/index.d.ts', () => {
		expect(existsSync(SELF_SYNC_GUARD_DTS_FILE)).toBe(true)
	})

	it('is self-contained with no #scripts/* import a consumer cannot resolve', () => {
		expect(readFileSync(SELF_SYNC_GUARD_DTS_FILE, 'utf8')).not.toContain('#scripts/')
	})

	it('re-exports the public API surface', () => {
		const content = readFileSync(SELF_SYNC_GUARD_DTS_FILE, 'utf8')

		expect(content).toContain('self_sync_guard')
		expect(content).toContain('self_sync_refusal')
	})
})

describe('package.json — the ./self-sync-guard export', () => {
	it('points at the files the build writes', () => {
		const manifest = JSON.parse(
			readFileSync(path.join(import.meta.dirname, '..', MANIFEST), 'utf8'),
		) as { exports: Record<string, { types: string; default: string }> }
		const entry = manifest.exports['./self-sync-guard']

		expect(entry?.default).toBe('./dist/self-sync-guard/index.js')
		expect(entry?.types).toBe('./dist/self-sync-guard/index.d.ts')
	})
})
