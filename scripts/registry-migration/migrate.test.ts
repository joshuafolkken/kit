import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { dump } from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'
import { migrate, sha512, type MigrationDependencies } from './migrate'
import { migrate_files } from './migrate-files'
import { migrate_lock } from './migrate-lock'

const make_directory = temporary_directory()
const VERSION = '1.0.0'
const TARGET = '2.0.0'
const CHILD = `${migrate_lock.SCOPE}child`
const NPMRC =
	'@joshuafolkken:registry=https://npm.pkg.github.com\n@other:registry=https://other.example\n//npm.pkg.github.com/:_authToken=${TOKEN}\n'
const BYTES = new TextEncoder().encode('verified fixture artifact')
const INTEGRITY = sha512(BYTES)
const FOREIGN = 'https://npm.pkg.github.com/download/'
const LOCKFILE = 'pnpm-lock.yaml'
const OLD_KIT_PATH = 'node_modules/@joshuafolkken/kit/package.json'
const OLD_KIT_CONTENT = 'invalid old kit'
const NETWORK_ERROR = 'network unavailable'
const RESOLVER_ERROR = 'resolver failed'
const CONCURRENT_CHANGE = 'concurrent change\n'
const USER_CONFIG = 'user.npmrc'
const MANIFEST = 'package.json'

function lockfile(registry: string): string {
	const resolution = { integrity: INTEGRITY, tarball: `${registry}package.tgz` }

	return dump({
		lockfileVersion: '9.0',
		importers: {
			'.': { devDependencies: { [migrate_lock.KIT]: { specifier: '^1.0.0', version: VERSION } } },
		},
		packages: {
			[`${migrate_lock.KIT}@${VERSION}`]: { resolution },
			[`${CHILD}@${VERSION}`]: { resolution },
		},
		snapshots: {
			[`${migrate_lock.KIT}@${VERSION}`]: { dependencies: { [CHILD]: VERSION } },
			[`${CHILD}@${VERSION}`]: {},
		},
	})
}

function project(): string {
	const root = make_directory('registry-migration-')

	write_file(root, MANIFEST, JSON.stringify({ devDependencies: { [migrate_lock.KIT]: '^1.0.0' } }))
	write_file(root, '.npmrc', NPMRC)
	write_file(root, LOCKFILE, lockfile(FOREIGN))

	return root
}

function dependencies(): MigrationDependencies {
	return {
		publication: (name, version) => ({
			name,
			version,
			dist: { tarball: `${migrate_lock.REGISTRY}package.tgz`, integrity: INTEGRITY },
		}),
		download: async () => BYTES,
		resolve: (directory) =>
			writeFileSync(path.join(directory, LOCKFILE), lockfile(migrate_lock.REGISTRY)),
		pnpm_version: () => migrate_lock.PNPM_VERSION,
	}
}

function contents(root: string): Array<string | undefined> {
	return migrate_files.snapshot(root).map((file) => file.content)
}

function failed_resolution(): void {
	throw new Error(RESOLVER_ERROR)
}

function changed_resolution(directory: string): void {
	write_file(
		directory,
		LOCKFILE,
		lockfile(migrate_lock.REGISTRY).replaceAll(VERSION, () => TARGET),
	)
}

function stale_resolution(): void {
	return undefined
}

describe('standalone registry migration — configuration', () => {
	it('migrates an old kit without loading it, preserving other scopes and auth (ac-f1629986)', async () => {
		const root = project()

		write_file(root, OLD_KIT_PATH, OLD_KIT_CONTENT)
		expect(await migrate(root, TARGET, false, dependencies())).toEqual(['.npmrc', LOCKFILE])
		expect(readFileSync(path.join(root, '.npmrc'), 'utf8')).toBe(migrate_lock.npmrc(NPMRC))
		expect(readFileSync(path.join(root, OLD_KIT_PATH), 'utf8')).toBe(OLD_KIT_CONTENT)
	})

	it('checks all direct and indirect versions and the target, with no installed kit (ac-8b4e8d0b)', async () => {
		const root = project()
		const deps = dependencies()
		const publication = vi.fn(deps.publication)

		await migrate(root, TARGET, false, { ...deps, publication })
		expect(publication.mock.calls).toContainEqual([migrate_lock.KIT, VERSION])
		expect(publication.mock.calls).toContainEqual([CHILD, VERSION])
		expect(publication.mock.calls).toContainEqual([migrate_lock.KIT, TARGET])
	})

	it('reports the same dry-run changes without mutation, then reruns with no diff (ac-05c501e3)', async () => {
		const root = project()
		const before = contents(root)

		expect(await migrate(root, TARGET, true, dependencies())).toEqual(['.npmrc', LOCKFILE])
		expect(contents(root)).toEqual(before)
		await migrate(root, TARGET, false, dependencies())
		expect(await migrate(root, TARGET, false, dependencies())).toEqual([])
	})
})

describe('standalone registry migration — publication failures', () => {
	it('reports every unavailable publication and leaves all originals intact', async () => {
		const root = project()
		const before = contents(root)
		const result = migrate(root, TARGET, false, { ...dependencies(), publication: () => undefined })

		await expect(result).rejects.toThrow(`${CHILD}@${VERSION}`)
		expect(contents(root)).toEqual(before)
	})

	it('refuses different same-version bytes before the resolver runs (ac-59e7c37d)', async () => {
		const root = project()
		const deps = dependencies()
		const resolve = vi.fn(deps.resolve)
		const different = new TextEncoder().encode('different distribution')

		await expect(
			migrate(root, TARGET, false, {
				...deps,
				resolve,
				publication: (name, version) => ({
					name,
					version,
					dist: { tarball: `${migrate_lock.REGISTRY}other.tgz`, integrity: sha512(different) },
				}),
				download: async () => different,
			}),
		).rejects.toThrow('Artifact differs from locked bytes')
		expect(resolve).not.toHaveBeenCalled()
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})
})

describe('standalone registry migration — network failures', () => {
	it('refuses corrupt npm bytes and network errors with dry-run failure reasons', async () => {
		const root = project()

		await expect(
			migrate(root, TARGET, true, { ...dependencies(), download: async () => new Uint8Array() }),
		).rejects.toThrow('npm artifact integrity mismatch')
		await expect(
			migrate(root, TARGET, true, {
				...dependencies(),
				download: async () => {
					throw new Error(NETWORK_ERROR)
				},
			}),
		).rejects.toThrow(NETWORK_ERROR)
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})
})

describe('standalone registry migration — resolution failures', () => {
	it('does not mutate originals when resolution fails midway', async () => {
		const root = project()

		await expect(
			migrate(root, TARGET, false, { ...dependencies(), resolve: failed_resolution }),
		).rejects.toThrow(RESOLVER_ERROR)
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})

	it('rejects graph changes and a resolver that keeps GitHub tarballs', async () => {
		const root = project()

		await expect(
			migrate(root, TARGET, false, { ...dependencies(), resolve: changed_resolution }),
		).rejects.toThrow('dependency graph')
		await expect(
			migrate(root, TARGET, false, { ...dependencies(), resolve: stale_resolution }),
		).rejects.toThrow('Non-npm resolution remains')
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})

	it('refuses unverified pnpm versions and non-exact target versions', async () => {
		const root = project()

		await expect(
			migrate(root, TARGET, false, { ...dependencies(), pnpm_version: () => '10.0.0' }),
		).rejects.toThrow('Verified pnpm version')
		await expect(migrate(root, 'latest', false, dependencies())).rejects.toThrow('exact target')
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})
})

describe('migration transaction', () => {
	it('keeps originals if preparing staged replacements fails', async () => {
		const root = project()
		const original = atomic_write.replace_file
		const failure = vi
			.spyOn(atomic_write, 'replace_file')
			.mockImplementationOnce(original)
			.mockImplementationOnce(() => {
				throw new Error('disk full')
			})

		try {
			await expect(migrate(root, TARGET, false, dependencies())).rejects.toThrow('disk full')
			expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
		} finally {
			failure.mockRestore()
		}
	})

	it('preserves a concurrent writer instead of overwriting its configuration', async () => {
		const root = project()
		const deps = dependencies()

		function resolve(directory: string): void {
			deps.resolve(directory)
			write_file(root, '.npmrc', CONCURRENT_CHANGE)
		}

		await expect(migrate(root, TARGET, false, { ...deps, resolve })).rejects.toThrow(
			'changed concurrently',
		)
		expect(contents(root)).toEqual([CONCURRENT_CHANGE, lockfile(FOREIGN)])
	})
})

describe('migration scope precedence', () => {
	it('uses npm despite the user mapping and leaves that user file unchanged', async () => {
		const root = project()
		const user_config = path.join(root, USER_CONFIG)

		write_file(root, USER_CONFIG, NPMRC)
		await migrate(root, TARGET, false, dependencies())
		const effective = execFileSync('pnpm', ['config', 'get', '@joshuafolkken:registry'], {
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env, NPM_CONFIG_USERCONFIG: user_config },
		})

		expect(effective.trim()).toBe(migrate_lock.REGISTRY)
		expect(readFileSync(user_config, 'utf8')).toBe(NPMRC)
	})
})

describe('migration workspace isolation', () => {
	it('refuses a nested workspace invocation and leaves the root configuration intact', async () => {
		const root = project()

		write_file(root, 'pnpm-workspace.yaml', 'packages: [packages/*]\n')
		write_file(root, 'packages/app/package.json', '{}')
		await expect(
			migrate(path.join(root, 'packages/app'), TARGET, false, dependencies()),
		).rejects.toThrow('workspace root')
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})

	it('refuses a manifest changed during isolated resolution', async () => {
		const root = project()
		const deps = dependencies()

		function resolve(directory: string): void {
			deps.resolve(directory)
			write_file(root, MANIFEST, '{"name":"concurrently-edited"}')
		}

		await expect(migrate(root, TARGET, false, { ...deps, resolve })).rejects.toThrow(
			'Resolution input changed',
		)
		expect(contents(root)).toEqual([NPMRC, lockfile(FOREIGN)])
	})
})
