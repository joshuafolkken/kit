import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolve_effective_upstream_version } from './effective-upstream'

const PKG_NAME = '@fixture/pkg'
const PKG_VERSION = '9.9.9'
const NESTED_NAME = '@fixture/nested'
const NESTED_VERSION = '1.1.1'
const ABSENT_NAME = '@fixture/absent'
const PACKAGE_JSON = 'package.json'
const CONSUMER_FILE = 'consumer.js'
const SEMVER_PATTERN = /^\d+\.\d+\.\d+/u

// Build a throwaway node_modules tree so the resolver can be exercised against a real `createRequire`
// resolution: `@fixture/pkg` exposes both its root (`.`) and a nested `./marker` subpath, and nests a
// differently-named package.json under `sub/` to prove the walk-up matches the root by name.
function build_fixture(root: string): void {
	const package_directory = path.join(root, 'node_modules', '@fixture', 'pkg')
	const sub_directory = path.join(package_directory, 'sub')

	mkdirSync(sub_directory, { recursive: true })
	writeFileSync(
		path.join(package_directory, PACKAGE_JSON),
		JSON.stringify({
			name: PKG_NAME,
			version: PKG_VERSION,
			exports: Object.fromEntries([
				['.', './index.js'],
				['./marker', './sub/deep.js'],
			]),
		}),
	)
	writeFileSync(path.join(package_directory, 'index.js'), '')
	writeFileSync(path.join(sub_directory, 'deep.js'), '')
	writeFileSync(
		path.join(sub_directory, PACKAGE_JSON),
		JSON.stringify({ name: NESTED_NAME, version: NESTED_VERSION }),
	)
}

describe('resolve_effective_upstream_version', () => {
	let root = ''
	let base_url = ''

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'kit-eff-'))
		build_fixture(root)
		base_url = pathToFileURL(path.join(root, CONSUMER_FILE)).href
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	it("resolves a package's root version relative to the base", () => {
		expect(resolve_effective_upstream_version(base_url, PKG_NAME)).toBe(PKG_VERSION)
	})

	it('walks up past a differently-named nested package.json to the matching root', () => {
		const resolved = resolve_effective_upstream_version(base_url, PKG_NAME, {
			resolve_marker: `${PKG_NAME}/marker`,
		})

		expect(resolved).toBe(PKG_VERSION)
	})

	it('returns undefined for a package that is not installed relative to the base', () => {
		expect(resolve_effective_upstream_version(base_url, ABSENT_NAME)).toBeUndefined()
	})

	it('returns undefined (never throws) for an unresolvable base url', () => {
		const missing_base = pathToFileURL(path.join(root, 'missing', 'deep', CONSUMER_FILE)).href

		expect(resolve_effective_upstream_version(missing_base, ABSENT_NAME)).toBeUndefined()
	})

	it('resolves a real installed dependency relative to this module', () => {
		expect(resolve_effective_upstream_version(import.meta.url, 'zod')).toMatch(SEMVER_PATTERN)
	})
})
