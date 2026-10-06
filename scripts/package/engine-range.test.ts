import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { engine_range } from './engine-range'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DECLARED = '^22.19.0 || ^24.0.0 || >=26.0.0'

const SELF_DOCUMENT = `---
lockfileVersion: '9.0'
packages:
  pnpm@12.6.0:
    engines: {node: '>=22.13'}
snapshots:
  pnpm@12.6.0: {}
`

const PROJECT_DOCUMENT = `---
lockfileVersion: '9.0'
packages:
  vitest@5.0.3:
    engines: {node: ^22.12.0 || ^24.0.0 || >=26.0.0}
  narrow@1.0.0:
    engines: {node: '>=24.0.0'}
  native-linux@1.0.0:
    engines: {node: ^22.20 || ^24.12}
  plain@1.0.0:
    resolution: {integrity: sha512-x}
snapshots:
  vitest@5.0.3(@types/node@26.0.0):
    dependencies:
      narrow: 1.0.0
  narrow@1.0.0: {}
  native-linux@1.0.0:
    optional: true
  plain@1.0.0: {}
`

interface PackageJson {
	engines: { node: string }
}

const VITEST_KEY = 'vitest@5.0.3'
const NARROW_KEY = 'narrow@1.0.0'

function conflict_keys(declared: string, lockfile: string): Array<string> {
	return engine_range.find_conflicts(declared, lockfile).map(({ key }) => key)
}

describe('engine_range.find_conflicts', () => {
	it('reports a required package whose engines exclude part of the declared range', () => {
		expect(engine_range.find_conflicts(DECLARED, PROJECT_DOCUMENT)).toEqual([
			{ key: NARROW_KEY, range: '>=24.0.0' },
		])
	})

	it('ignores an optional package, which pnpm skips instead of failing the install', () => {
		expect(conflict_keys(DECLARED, PROJECT_DOCUMENT)).not.toContain('native-linux@1.0.0')
	})

	it('reads every document and maps a peer-suffixed snapshot to its package', () => {
		expect(conflict_keys('>=20.0.0', SELF_DOCUMENT + PROJECT_DOCUMENT)).toEqual([
			'pnpm@12.6.0',
			VITEST_KEY,
			NARROW_KEY,
		])
	})

	it('reports the Node 25 gap of a range that is still open-ended', () => {
		expect(conflict_keys('>=22.19.0', PROJECT_DOCUMENT)).toContain(VITEST_KEY)
	})
})

describe('package.json engines.node', () => {
	it('stays inside the engines of every required package in pnpm-lock.yaml', () => {
		const package_json = JSON.parse(
			readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
		) as PackageJson
		const lockfile = readFileSync(path.join(PACKAGE_ROOT, 'pnpm-lock.yaml'), 'utf8')

		expect(engine_range.find_conflicts(package_json.engines.node, lockfile)).toEqual([])
	})
})
