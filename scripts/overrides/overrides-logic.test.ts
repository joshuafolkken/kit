import { describe, expect, it } from 'vitest'
import { overrides_check } from './overrides-logic'

function make_overrides(entries: Array<[string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

function make_package_json(
	deps: Record<string, string>,
	development_deps: Record<string, string>,
): string {
	return JSON.stringify({
		dependencies: deps,
		devDependencies: development_deps,
	})
}

const CAPPED_PKG_KEY = 'some-pkg@>=5'
const CAPPED_PKG_VALUE = '^4'
const ESBUILD_KEY = 'esbuild@<=0.24.2'
const ESBUILD_VALUE = '>=0.25.0'
const COOKIE_KEY = 'cookie@<0.7.0'
const COOKIE_VALUE = '>=0.7.0'
const NEW_PKG_KEY = 'new-pkg@>=1'

describe('overrides_check.compare — no changes', () => {
	it('returns no changes for identical overrides', () => {
		const overrides = make_overrides([
			[CAPPED_PKG_KEY, CAPPED_PKG_VALUE],
			[ESBUILD_KEY, ESBUILD_VALUE],
		])
		const result = overrides_check.compare(overrides, { ...overrides })

		expect(result.is_changed).toBe(false)
		expect(result.added).toHaveLength(0)
		expect(result.removed).toHaveLength(0)
		expect(result.modified).toHaveLength(0)
	})

	it('handles empty overrides on both sides', () => {
		const result = overrides_check.compare({}, {})

		expect(result.is_changed).toBe(false)
	})
})

describe('overrides_check.compare — added and removed', () => {
	it('detects added entries', () => {
		const snapshot = make_overrides([[CAPPED_PKG_KEY, CAPPED_PKG_VALUE]])
		const current = make_overrides([
			[CAPPED_PKG_KEY, CAPPED_PKG_VALUE],
			[NEW_PKG_KEY, '^2'],
		])
		const result = overrides_check.compare(snapshot, current)

		expect(result.is_changed).toBe(true)
		expect(result.added).toEqual([{ key: NEW_PKG_KEY, value: '^2' }])
	})

	it('detects removed entries', () => {
		const snapshot = make_overrides([
			[CAPPED_PKG_KEY, CAPPED_PKG_VALUE],
			[ESBUILD_KEY, ESBUILD_VALUE],
		])
		const current = make_overrides([[ESBUILD_KEY, ESBUILD_VALUE]])
		const result = overrides_check.compare(snapshot, current)

		expect(result.is_changed).toBe(true)
		expect(result.removed).toEqual([{ key: CAPPED_PKG_KEY, value: CAPPED_PKG_VALUE }])
	})
})

describe('overrides_check.compare — modified and mixed', () => {
	it('detects modified entries', () => {
		const snapshot = make_overrides([[CAPPED_PKG_KEY, CAPPED_PKG_VALUE]])
		const current = make_overrides([[CAPPED_PKG_KEY, '^10']])
		const result = overrides_check.compare(snapshot, current)

		expect(result.is_changed).toBe(true)
		expect(result.modified).toEqual([
			{ key: CAPPED_PKG_KEY, old_value: CAPPED_PKG_VALUE, new_value: '^10' },
		])
	})

	it('detects multiple changes at once', () => {
		const snapshot = make_overrides([
			['a', '1'],
			['b', '2'],
			['c', '3'],
		])
		const current = make_overrides([
			['a', '1'],
			['b', '99'],
			['d', '4'],
		])
		const result = overrides_check.compare(snapshot, current)

		expect(result.is_changed).toBe(true)
		expect(result.added).toEqual([{ key: 'd', value: '4' }])
		expect(result.removed).toEqual([{ key: 'c', value: '3' }])
		expect(result.modified).toEqual([{ key: 'b', old_value: '2', new_value: '99' }])
	})
})

describe('overrides_check.read_overrides_from_package', () => {
	it('extracts overrides from package.json content', () => {
		const overrides = make_overrides([['foo@>=1', '^2']])
		const content = JSON.stringify({ pnpm: { overrides } })

		expect(overrides_check.read_overrides_from_package(content)).toEqual(overrides)
	})

	it('returns empty object when no pnpm section', () => {
		const content = JSON.stringify({ name: 'test' })

		expect(overrides_check.read_overrides_from_package(content)).toEqual({})
	})

	it('returns empty object when no overrides section', () => {
		const content = JSON.stringify({ pnpm: {} })

		expect(overrides_check.read_overrides_from_package(content)).toEqual({})
	})
})

describe('overrides_check.extract_capped_package_names', () => {
	it('extracts packages with >= lower-bound constraints', () => {
		const overrides = make_overrides([
			[CAPPED_PKG_KEY, CAPPED_PKG_VALUE],
			[ESBUILD_KEY, ESBUILD_VALUE],
		])

		expect(overrides_check.extract_capped_package_names(overrides)).toEqual(['some-pkg'])
	})

	it('extracts packages with > lower-bound constraints', () => {
		const overrides = make_overrides([['pkg@>5', '^4']])

		expect(overrides_check.extract_capped_package_names(overrides)).toEqual(['pkg'])
	})

	it('excludes range constraints with both >= and <=', () => {
		const overrides = make_overrides([['lodash@>=4.0.0 <=4.17.22', '>=4.17.23']])

		expect(overrides_check.extract_capped_package_names(overrides)).toEqual([])
	})

	it('excludes upper-bound constraints (<=, <)', () => {
		const overrides = make_overrides([
			[ESBUILD_KEY, ESBUILD_VALUE],
			[COOKIE_KEY, COOKIE_VALUE],
		])

		expect(overrides_check.extract_capped_package_names(overrides)).toEqual([])
	})

	it('handles scoped packages correctly', () => {
		const overrides = make_overrides([['@scope/pkg@>=2', '^1']])

		expect(overrides_check.extract_capped_package_names(overrides)).toEqual(['@scope/pkg'])
	})

	it('returns empty array when no overrides', () => {
		expect(overrides_check.extract_capped_package_names({})).toEqual([])
	})

	it('ignores keys without version constraint', () => {
		const overrides = make_overrides([['bare-pkg', '^1']])

		expect(overrides_check.extract_capped_package_names(overrides)).toEqual([])
	})
})

describe('integration: filtering capped packages from update targets', () => {
	it('excludes capped-override packages from dependency list', () => {
		const overrides = make_overrides([
			[CAPPED_PKG_KEY, CAPPED_PKG_VALUE],
			[ESBUILD_KEY, ESBUILD_VALUE],
			[COOKIE_KEY, COOKIE_VALUE],
		])
		const content = make_package_json(
			{ svelte: '^5.0.0' },
			{ 'some-pkg': '^4.0.0', esbuild: '^0.25.0', vitest: '^3.0.0' },
		)

		const capped = overrides_check.extract_capped_package_names(overrides)
		const all_names = overrides_check.read_dep_names(content)
		const capped_set = new Set(capped)
		const targets = all_names.filter((name) => !capped_set.has(name))

		expect(capped).toEqual(['some-pkg'])
		expect(targets).toEqual(['svelte', 'esbuild', 'vitest'])
	})

	it('returns all deps when no capped overrides exist', () => {
		const overrides = make_overrides([[ESBUILD_KEY, ESBUILD_VALUE]])
		const content = make_package_json({}, { esbuild: '^0.25.0', vitest: '^3.0.0' })

		const capped = overrides_check.extract_capped_package_names(overrides)
		const all_names = overrides_check.read_dep_names(content)
		const targets = all_names.filter((name) => !new Set(capped).has(name))

		expect(targets).toEqual(['esbuild', 'vitest'])
	})
})

describe('overrides_check.build_update_command', () => {
	it('returns unfiltered command when no capped overrides exist', () => {
		const overrides = make_overrides([[ESBUILD_KEY, ESBUILD_VALUE]])
		const content = make_package_json({ svelte: '^5' }, { vitest: '^3' })

		expect(overrides_check.build_update_command(overrides, content)).toBe('pnpm update --latest')
	})

	it('excludes capped-override packages from update targets', () => {
		const overrides = make_overrides([
			[CAPPED_PKG_KEY, CAPPED_PKG_VALUE],
			[ESBUILD_KEY, ESBUILD_VALUE],
		])
		const content = make_package_json({ svelte: '^5' }, { 'some-pkg': '^4', vitest: '^3' })
		const result = overrides_check.build_update_command(overrides, content)

		expect(result).toBe('pnpm update --latest svelte vitest')
	})

	it('returns undefined when all packages are capped', () => {
		const overrides = make_overrides([[CAPPED_PKG_KEY, CAPPED_PKG_VALUE]])
		const content = make_package_json({}, { 'some-pkg': '^4' })

		expect(overrides_check.build_update_command(overrides, content)).toBeUndefined()
	})
})

describe('overrides_check.read_dep_names', () => {
	it('returns all dependency and devDependency names', () => {
		const content = make_package_json(
			{ svelte: '^5.0.0', drizzle: '^1.0.0' },
			{ vitest: '^3.0.0', typescript: '^6.0.0' },
		)

		expect(overrides_check.read_dep_names(content)).toEqual([
			'svelte',
			'drizzle',
			'vitest',
			'typescript',
		])
	})

	it('handles missing dependencies section', () => {
		const content = JSON.stringify({ devDependencies: { vitest: '^3.0.0' } })

		expect(overrides_check.read_dep_names(content)).toEqual(['vitest'])
	})

	it('handles missing devDependencies section', () => {
		const content = JSON.stringify({ dependencies: { svelte: '^5.0.0' } })

		expect(overrides_check.read_dep_names(content)).toEqual(['svelte'])
	})

	it('returns empty array for package.json with no deps', () => {
		const content = JSON.stringify({ name: 'test' })

		expect(overrides_check.read_dep_names(content)).toEqual([])
	})
})

const SCHEMA_REJECTS_NON_OBJECTS = 'throws on non-object JSON (schema rejects non-objects)'

describe('overrides_check.read_overrides_from_package — schema validation', () => {
	it('returns empty object when pnpm field is absent', () => {
		expect(overrides_check.read_overrides_from_package(JSON.stringify({ name: 'test' }))).toEqual(
			{},
		)
	})

	it(SCHEMA_REJECTS_NON_OBJECTS, () => {
		expect(() => overrides_check.read_overrides_from_package(JSON.stringify([1, 2]))).toThrow()
	})
})

describe('overrides_check.read_dep_names — schema validation', () => {
	it(SCHEMA_REJECTS_NON_OBJECTS, () => {
		expect(() => overrides_check.read_dep_names(JSON.stringify('not-an-object'))).toThrow()
	})
})
