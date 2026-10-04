import { describe, expect, it } from 'vitest'
import { PACKAGE_JSON_KEY_ORDER } from './init-logic-package-key-order'

// A key missing from the order would index as -1 and pass every "before" comparison vacuously.
function index_of(key: string): number {
	expect(PACKAGE_JSON_KEY_ORDER).toContain(key)

	return PACKAGE_JSON_KEY_ORDER.indexOf(key)
}

describe('PACKAGE_JSON_KEY_ORDER', () => {
	it('starts with name and version', () => {
		expect(PACKAGE_JSON_KEY_ORDER.slice(0, ['name', 'version'].length)).toStrictEqual([
			'name',
			'version',
		])
	})

	it('ends with pnpm', () => {
		expect(PACKAGE_JSON_KEY_ORDER.at(-1)).toBe('pnpm')
	})

	it('contains no duplicate keys', () => {
		expect(new Set(PACKAGE_JSON_KEY_ORDER).size).toBe(PACKAGE_JSON_KEY_ORDER.length)
	})
})

describe('PACKAGE_JSON_KEY_ORDER relative positions', () => {
	it('places scripts before the dependency blocks', () => {
		expect(index_of('scripts')).toBeLessThan(index_of('dependencies'))
		expect(index_of('dependencies')).toBeLessThan(index_of('devDependencies'))
		expect(index_of('devDependencies')).toBeLessThan(index_of('peerDependencies'))
	})

	it('places packageManager, engines and devEngines consecutively after overrides', () => {
		const start = index_of('packageManager')

		expect(index_of('overrides')).toBeLessThan(start)
		expect(PACKAGE_JSON_KEY_ORDER.slice(start, start + ['a', 'b', 'c'].length)).toStrictEqual([
			'packageManager',
			'engines',
			'devEngines',
		])
	})

	it('places the module entry fields between files and repository', () => {
		const entry_fields = ['main', 'browser', 'exports', 'imports', 'bin']

		for (const field of entry_fields) {
			expect(index_of(field)).toBeGreaterThan(index_of('files'))
			expect(index_of(field)).toBeLessThan(index_of('repository'))
		}
	})

	it('places private immediately before scripts', () => {
		expect(index_of('scripts') - index_of('private')).toBe(1)
	})
})
