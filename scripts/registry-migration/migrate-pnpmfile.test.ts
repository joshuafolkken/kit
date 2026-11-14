import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { npm_registry } from '#scripts/version/npm-registry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pnpm_version, resolve, sha512 } from './migrate'
import { main } from './migrate-cli'
import { migrate_files } from './migrate-files'
import { migrate_lock } from './migrate-lock'

vi.mock(import('#scripts/version/npm-registry'), async (import_original) => {
	const original = await import_original()

	return {
		npm_registry: { ...original.npm_registry, read_public_version: vi.fn() },
	}
})

const make_directory = temporary_directory()
const LOCKFILE = 'pnpm-lock.yaml'
const CHECKSUM = 'pnpmfileChecksum: sha256-original\n'
const MARKER = 'pnpmfile-executed'
const NPMRC =
	'@joshuafolkken:registry=https://npm.pkg.github.com\n@other:registry=https://other.example\n'
const BYTES = new TextEncoder().encode('verified migration fixture')
const VERSION = '1.0.0'

function project(): string {
	const root = make_directory('migration-pnpmfile-')
	const marker = JSON.stringify(path.join(root, MARKER))

	write_file(
		root,
		'package.json',
		JSON.stringify({ private: true, packageManager: `pnpm@${migrate_lock.PNPM_VERSION}` }),
	)
	write_file(root, '.npmrc', NPMRC)
	write_file(root, '.pnpmfile.cjs', `require('node:fs').writeFileSync(${marker}, 'executed')`)
	resolve(root)
	write_file(
		root,
		LOCKFILE,
		readFileSync(path.join(root, LOCKFILE), 'utf8').replace(
			'settings:',
			() => `${CHECKSUM}settings:`,
		),
	)

	return root
}

function contents(root: string): Array<string | undefined> {
	return migrate_files.snapshot(root).map((file) => file.content)
}

function mock_publication(root: string): void {
	vi.spyOn(process, 'cwd').mockReturnValue(root)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(npm_registry.read_public_version).mockImplementation((name, version) => ({
		name,
		version,
		dist: { tarball: `${migrate_lock.REGISTRY}fixture.tgz`, integrity: sha512(BYTES) },
	}))
	vi.stubGlobal(
		'fetch',
		vi.fn().mockImplementation(async () => new Response(BYTES)),
	)
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('standalone migration with ignored pnpmfile metadata', () => {
	it('dry-runs with the pinned real pnpm without changing originals (ac-d9fd28ba)', async () => {
		const root = project()
		const before = contents(root)

		mock_publication(root)
		expect(pnpm_version()).toBe(migrate_lock.PNPM_VERSION)
		await main([VERSION, '--dry-run'])
		expect(contents(root)).toEqual(before)
		expect(console.info).toHaveBeenCalledWith('Planned: .npmrc, pnpm-lock.yaml')
		expect(existsSync(path.join(root, MARKER))).toBe(false)
	})

	it('migrates the root mapping, retains the checksum and reruns with no diff (ac-71dd529a)', async () => {
		const root = project()

		mock_publication(root)
		await main([VERSION])
		const migrated = contents(root)

		expect(migrated).toEqual([migrate_lock.npmrc(NPMRC), expect.stringContaining(CHECKSUM)])
		await main([VERSION])
		expect(contents(root)).toEqual(migrated)
		expect(console.info).toHaveBeenCalledWith('Changed: none')
		expect(existsSync(path.join(root, MARKER))).toBe(false)
	})

	it('keeps originals when real resolution changes unrelated metadata (ac-8669e955)', async () => {
		const root = project()

		write_file(root, LOCKFILE, `${readFileSync(path.join(root, LOCKFILE), 'utf8')}other: true\n`)
		const before = contents(root)

		mock_publication(root)
		await expect(main([VERSION])).rejects.toThrow('dependency graph')
		expect(contents(root)).toEqual(before)
		expect(existsSync(path.join(root, MARKER))).toBe(false)
	})
})
