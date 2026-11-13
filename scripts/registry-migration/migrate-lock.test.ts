import { describe, expect, it } from 'vitest'
import { migrate_lock } from './migrate-lock'

const SELF_MANAGEMENT =
	'lockfileVersion: "9.0"\nimporters:\n  .:\n    packageManagerDependencies: {}\n'
const PROJECT =
	'lockfileVersion: "9.0"\npackages:\n  "@joshuafolkken/child@1.0.0":\n    resolution: {integrity: sha512-old}\n'
const OLD_INTEGRITY = 'sha512-old'
const GRAPH_ERROR = 'dependency graph'

describe('migration lockfile contracts', () => {
	it('finds scoped versions across pnpm multi-document locks', () => {
		expect(migrate_lock.scoped_artifacts(`${SELF_MANAGEMENT}---\n${PROJECT}`)).toEqual([
			{ name: '@joshuafolkken/child', version: '1.0.0', integrity: OLD_INTEGRITY },
		])
	})

	it('retains the self-management document and rejects a graph change', () => {
		const before = `${SELF_MANAGEMENT}---\n${PROJECT}`

		expect(() =>
			migrate_lock.assert_preserved(before, before.replace(OLD_INTEGRITY, 'sha512-new')),
		).toThrow(GRAPH_ERROR)
		expect(() => migrate_lock.assert_preserved(before, PROJECT)).toThrow(GRAPH_ERROR)
		expect(() => migrate_lock.assert_preserved(before, before.replace('1.0.0', '2.0.0'))).toThrow(
			GRAPH_ERROR,
		)
	})

	it('overrides user scope mapping with one project mapping while keeping auth and CRLF', () => {
		const existing =
			'# keep\r\n@other:registry=https://other.example\r\n//registry.npmjs.org/:_authToken=${TOKEN}\r\n'
		const migrated = migrate_lock.npmrc(existing)

		expect(migrated).toContain(existing)
		expect(migrated).toContain(`@joshuafolkken:registry=${migrate_lock.REGISTRY}\r\n`)
		expect(migrate_lock.npmrc(migrated)).toBe(migrated)
	})
})

describe('migration source checks', () => {
	it('rejects the same non-npm source for assertions and migration-state detection', () => {
		const lock = PROJECT.replace(
			'integrity: sha512-old',
			'tarball: https://npm.pkg.github.com/old.tgz',
		)

		expect(migrate_lock.has_npm_sources(lock)).toBe(false)
		expect(() => migrate_lock.assert_npm_sources(lock)).toThrow('Non-npm resolution remains:')
	})

	it.each(['', PROJECT, `${SELF_MANAGEMENT}---\n${PROJECT}`])(
		'accepts npm/default sources: %s',
		(lock) => {
			expect(migrate_lock.has_npm_sources(lock)).toBe(true)
			expect(() => migrate_lock.assert_npm_sources(lock)).not.toThrow()
		},
	)

	it('surfaces malformed lockfiles rather than treating a parse failure as migrated', () => {
		expect(() => migrate_lock.has_npm_sources('packages: [')).toThrow()
	})
})
