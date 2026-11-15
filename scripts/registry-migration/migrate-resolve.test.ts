import { readFileSync } from 'node:fs'
import path from 'node:path'
import { INSTALL_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { execaSync } from 'execa'
import { dump } from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate, resolve, sha512, type MigrationDependencies } from './migrate'
import { migrate_files } from './migrate-files'
import { migrate_lock } from './migrate-lock'

vi.mock(import('execa'), async (import_original) => ({
	...(await import_original()),
	execaSync: vi.fn(),
}))

const make_directory = temporary_directory()
const mocked_execa = vi.mocked(execaSync)
const LOCKFILE = 'pnpm-lock.yaml'
const MANIFEST = 'package.json'
const NPMRC = '@joshuafolkken:registry=https://npm.pkg.github.com\n'
const FLOOR = '^1.0.0'
const LOCKED = '1.0.1'
const TARGET = '2.0.0'
const BYTES = new TextEncoder().encode('locked above its range floor')
const TIMEOUT_ERROR = 'Command timed out after 600000 milliseconds'

function lockfile(registry: string, specifier: string): string {
	const key = `${migrate_lock.KIT}@${LOCKED}`

	return dump({
		lockfileVersion: '9.0',
		importers: { '.': { devDependencies: { [migrate_lock.KIT]: { specifier, version: LOCKED } } } },
		packages: {
			[key]: { resolution: { integrity: sha512(BYTES), tarball: `${registry}kit.tgz` } },
		},
		snapshots: { [key]: {} },
	})
}

function manifest(specifier: string): string {
	return JSON.stringify({ devDependencies: { [migrate_lock.KIT]: specifier } })
}

// pnpm update raises each range to its locked version unless --no-save keeps it. Its last argument
// is the --lockfile-dir the migration resolves in.
function fake_pnpm(arguments_: ReadonlyArray<string>): string {
	if (arguments_.includes('--version')) return migrate_lock.PNPM_VERSION
	if (arguments_.includes('config')) return 'undefined'
	const specifier = arguments_.includes('--no-save') ? FLOOR : `^${LOCKED}`
	const directory = arguments_.at(-1) ?? ''

	write_file(directory, MANIFEST, manifest(specifier))
	write_file(directory, LOCKFILE, lockfile(migrate_lock.REGISTRY, specifier))

	return ''
}

function dependencies(): MigrationDependencies {
	return {
		publication: (name, version) => ({
			name,
			version,
			dist: { tarball: `${migrate_lock.REGISTRY}kit.tgz`, integrity: sha512(BYTES) },
		}),
		download: async () => BYTES,
		resolve,
		pnpm_version: () => migrate_lock.PNPM_VERSION,
	}
}

function project(): string {
	const root = make_directory('registry-migration-resolve-')

	write_file(root, MANIFEST, manifest(FLOOR))
	write_file(root, '.npmrc', NPMRC)
	write_file(root, LOCKFILE, lockfile('https://npm.pkg.github.com/download/', FLOOR))

	return root
}

beforeEach(() => {
	mocked_execa.mockReset()
	mocked_execa.mockImplementation((...call: Array<unknown>) => {
		const result = { stdout: fake_pnpm(String(call[1]).split(',')) }

		return result as ReturnType<typeof execaSync>
	})
})

function read(root: string, file: string): string {
	return readFileSync(path.join(root, file), 'utf8')
}

describe('registry migration resolution', () => {
	it('keeps ranges below a newer locked version and resolves under the install limit', () => {
		const root = project()

		resolve(root)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			expect.arrayContaining(['update', '--lockfile-only', '--no-save']),
			expect.objectContaining({ timeout: INSTALL_TIMEOUT_MS }),
		)
		expect(read(root, MANIFEST)).toBe(manifest(FLOOR))
	})

	it('migrates a consumer that locks a version above its range floor (ac-f807d48e)', async () => {
		const root = project()

		expect(await migrate(root, TARGET, false, dependencies())).toEqual(['.npmrc', LOCKFILE])
		expect(read(root, MANIFEST)).toBe(manifest(FLOOR))
		expect(migrate_lock.has_npm_sources(read(root, LOCKFILE))).toBe(true)
	})

	it('leaves every original unchanged when resolution times out (ac-b5cd8a9d)', async () => {
		const root = project()
		const before = migrate_files.snapshot(root)

		mocked_execa.mockImplementation(() => {
			throw new Error(TIMEOUT_ERROR)
		})
		await expect(migrate(root, TARGET, false, dependencies())).rejects.toThrow(TIMEOUT_ERROR)
		expect(migrate_files.snapshot(root)).toEqual(before)
		expect(read(root, MANIFEST)).toBe(manifest(FLOOR))
	})
})
