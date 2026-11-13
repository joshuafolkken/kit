import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { dump } from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	download,
	migrate,
	pnpm_version,
	resolve,
	sha512,
	type MigrationDependencies,
} from './migrate'
import { migrate_lock } from './migrate-lock'

const make_directory = temporary_directory()
const LOCKFILE = 'pnpm-lock.yaml'
const ORIGINAL = 'external lock must remain unchanged\n'
const BEFORE = dump({ lockfileVersion: '9.0', importers: { '.': {} } })
const BYTES = new TextEncoder().encode('fixture')
const MANIFEST = 'package.json'
const PRIVATE_MANIFEST = '{"private":true}'
const EXTERNAL_PREFIX = 'external-lock-'
const DIRECTORY_ERROR = 'lockfile directory'

function dependencies(): MigrationDependencies {
	return {
		publication: (name, version) => ({
			name,
			version,
			dist: { tarball: `${migrate_lock.REGISTRY}fixture.tgz`, integrity: sha512(BYTES) },
		}),
		download: async () => BYTES,
		resolve,
		pnpm_version: () => migrate_lock.PNPM_VERSION,
	}
}

function config(root: string, source: string, external: string): void {
	switch (source) {
		case 'workspace': {
			write_file(root, 'pnpm-workspace.yaml', dump({ lockfileDir: external }))
			break
		}

		case 'npmrc': {
			write_file(root, '.npmrc', `lockfile-dir=${external}\n`)
			break
		}

		default: {
			vi.stubEnv('PNPM_CONFIG_LOCKFILE_DIR', external)
		}
	}
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('migration runtime dependencies', () => {
	it('downloads bytes with redirects refused', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(BYTES))
		const url = `${migrate_lock.REGISTRY}fixture.tgz`

		vi.stubGlobal('fetch', fetch)
		expect(await download(url)).toEqual(BYTES)
		expect(fetch).toHaveBeenCalledWith(
			url,
			expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
		)
	})

	it('refuses non-npm artifacts and failed HTTP responses', async () => {
		const status = 503
		const fetch = vi.fn().mockResolvedValue(new Response(undefined, { status }))

		vi.stubGlobal('fetch', fetch)
		await expect(download('https://untrusted.invalid/package.tgz')).rejects.toThrow(
			'Non-npm artifact refused',
		)
		expect(fetch).not.toHaveBeenCalled()
		await expect(download(`${migrate_lock.REGISTRY}fixture.tgz`)).rejects.toThrow(String(status))
	})

	it('reads the installed pnpm version from the real executable', () => {
		expect(pnpm_version()).toBe(migrate_lock.PNPM_VERSION)
	})
})

describe('migration resolver write isolation', () => {
	it.each([
		{ source: 'workspace', dry: true },
		{ source: 'workspace', dry: false },
		{ source: 'environment', dry: true },
		{ source: 'environment', dry: false },
	])(
		'refuses an external $source lock with no root lock and dry-run=$dry',
		async ({ source, dry }) => {
			const root = make_directory('migration-dry-run-')
			const external = make_directory(EXTERNAL_PREFIX)

			write_file(root, MANIFEST, PRIVATE_MANIFEST)
			write_file(external, LOCKFILE, ORIGINAL)
			config(root, source, external)
			await expect(migrate(root, '1.0.0', dry, dependencies())).rejects.toThrow(DIRECTORY_ERROR)
			expect(readFileSync(path.join(external, LOCKFILE), 'utf8')).toBe(ORIGINAL)
			expect(existsSync(path.join(root, LOCKFILE))).toBe(false)
		},
	)
})

describe('migration ignored project configuration', () => {
	it('keeps an ignored project npmrc lockfile-dir unchanged during a dry-run', async () => {
		const root = make_directory('migration-npmrc-')
		const external = make_directory(EXTERNAL_PREFIX)

		write_file(root, MANIFEST, PRIVATE_MANIFEST)
		write_file(external, LOCKFILE, ORIGINAL)
		config(root, 'npmrc', external)
		expect(await migrate(root, '1.0.0', true, dependencies())).toContain(LOCKFILE)
		expect(readFileSync(path.join(external, LOCKFILE), 'utf8')).toBe(ORIGINAL)
	})
})

describe('migration existing lock isolation', () => {
	it.each([
		{ source: 'workspace', dry: true },
		{ source: 'workspace', dry: false },
		{ source: 'npmrc', dry: true },
		{ source: 'npmrc', dry: false },
		{ source: 'environment', dry: true },
		{ source: 'environment', dry: false },
	])('confines $source lockfile output on failure with dry-run=$dry', async ({ source, dry }) => {
		const root = make_directory('migration-isolation-')
		const external = make_directory(EXTERNAL_PREFIX)

		write_file(root, MANIFEST, PRIVATE_MANIFEST)
		write_file(root, LOCKFILE, BEFORE)
		write_file(external, LOCKFILE, ORIGINAL)
		config(root, source, external)
		await expect(migrate(root, '1.0.0', dry, dependencies())).rejects.toThrow(
			source === 'npmrc' ? 'dependency graph' : DIRECTORY_ERROR,
		)
		expect(readFileSync(path.join(external, LOCKFILE), 'utf8')).toBe(ORIGINAL)
		expect(readFileSync(path.join(root, LOCKFILE), 'utf8')).toBe(BEFORE)
	})
})
