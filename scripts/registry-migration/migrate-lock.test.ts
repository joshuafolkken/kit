import { dump } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { migrate_lock } from './migrate-lock'

const SELF_MANAGEMENT =
	'lockfileVersion: "9.0"\nimporters:\n  .:\n    packageManagerDependencies: {}\n'
const PROJECT =
	'lockfileVersion: "9.0"\npackages:\n  "@joshuafolkken/child@1.0.0":\n    resolution: {integrity: sha512-old}\n'
const OLD_INTEGRITY = 'sha512-old'
const CHANGED_INTEGRITY = 'sha512-changed'
const OTHER_INTEGRITY = 'sha512-other'
const GRAPH_ERROR = 'dependency graph'
const CHECKSUM = 'pnpmfileChecksum: sha256-original\n'
const CHECKSUM_VALUE = 'sha256-original'
const OTHER_PROJECT = `${PROJECT}  "@other/child@1.0.0":\n    resolution: {integrity: sha512-other}\nsnapshots: {kept: {}}\n`

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

describe('migration pnpmfile metadata', () => {
	it('restores only the omitted checksum in its original document', () => {
		const before = `${SELF_MANAGEMENT}---\n${CHECKSUM}${PROJECT}`
		const restored = migrate_lock.restore_pnpmfile_checksum(before, before.replace(CHECKSUM, ''))

		expect(() => migrate_lock.assert_preserved(before, restored)).not.toThrow()
		expect(restored).toContain(CHECKSUM)
		expect(migrate_lock.restore_pnpmfile_checksum(before, before)).toBe(before)
	})

	it.each([
		{ name: 'integrity', from: OLD_INTEGRITY, to: CHANGED_INTEGRITY },
		{ name: 'version', from: '1.0.0', to: '2.0.0' },
		{ name: 'other metadata', from: 'packageManagerDependencies: {}', to: 'other: true' },
		{ name: 'other scope resolution', from: OTHER_INTEGRITY, to: 'sha512-replaced' },
		{ name: 'snapshot', from: 'kept: {}', to: 'changed: {}' },
		{ name: 'checksum', from: CHECKSUM_VALUE, to: 'sha256-changed' },
	])('still refuses a changed $name after checksum restoration', ({ from, to }) => {
		const before = `${SELF_MANAGEMENT}---\n${CHECKSUM}${OTHER_PROJECT}`
		const changed = before.replace(from, () => to)
		const after = from === CHECKSUM_VALUE ? changed : changed.replace(CHECKSUM, '')

		expect(() =>
			migrate_lock.assert_preserved(before, migrate_lock.restore_pnpmfile_checksum(before, after)),
		).toThrow(GRAPH_ERROR)
	})
})

const KIT_KEY = `${migrate_lock.KIT}@1.0.0`
const OTHER_KEY = '@other/child@1.0.0'

function registry_lock(kit: object, other: object, peers: Array<string>): string {
	return dump({
		lockfileVersion: '9.0',
		packages: {
			[KIT_KEY]: { resolution: { integrity: OLD_INTEGRITY }, ...kit },
			[OTHER_KEY]: { resolution: { integrity: OTHER_INTEGRITY }, ...other },
		},
		snapshots: {
			[KIT_KEY]: { dependencies: { '@other/child': '1.0.0' }, transitivePeerDependencies: peers },
			[OTHER_KEY]: {},
		},
	})
}

const PEERS = ['svelte', 'vite']
const OPTIONAL_PEERS = { peerDependenciesMeta: { vite: { optional: true } } }
const DEPRECATED = { deprecated: 'use the new preset' }
const GITHUB_LOCK = registry_lock({}, {}, PEERS)

describe('migration registry metadata (ac-b88de8f7)', () => {
	it('accepts npm-only peer metadata, its peer order and an unrelated deprecation', () => {
		const npm_lock = registry_lock(OPTIONAL_PEERS, DEPRECATED, PEERS.toReversed())

		expect(() => migrate_lock.assert_preserved(GITHUB_LOCK, npm_lock)).not.toThrow()
	})

	it.each([
		{ name: 'integrity', from: OLD_INTEGRITY, to: CHANGED_INTEGRITY },
		{ name: 'version', from: '1.0.0', to: '1.0.1' },
		{ name: 'peer list member', from: 'vite', to: 'rollup' },
		{ name: 'graph edge', from: "'@other/child': 1.0.0", to: "'@other/child': 2.0.0" },
	])('still refuses a changed $name', ({ from, to }) => {
		expect(() =>
			migrate_lock.assert_preserved(
				GITHUB_LOCK,
				GITHUB_LOCK.replaceAll(from, () => to),
			),
		).toThrow(GRAPH_ERROR)
	})

	it('still refuses peer metadata outside this scope', () => {
		const changed = registry_lock({}, OPTIONAL_PEERS, PEERS)

		expect(() => migrate_lock.assert_preserved(GITHUB_LOCK, changed)).toThrow(GRAPH_ERROR)
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
