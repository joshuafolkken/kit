import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registry_migration, type MigrationDependencies } from './migrate'

const GH = '@joshuafolkken:registry=https://npm.pkg.github.com\n'
const NPMRC_PATH = '.npmrc'
const LOCKFILE_PATH = 'pnpm-lock.yaml'
const PUBLIC_HOST = 'registry.npmjs.org'
const RESTORED = 'original settings restored'
const LOCKFILE = `lockfileVersion: '9.0'\npackages:\n  '@joshuafolkken/kit@1.2.3':\n    resolution:\n      integrity: sha512-example\n      tarball: https://npm.pkg.github.com/download/@joshuafolkken/kit/1.2.3/example\n`
const ROOTS: Array<string> = []

function fixture(): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'registry-migrate-'))

	ROOTS.push(root)
	writeFileSync(path.join(root, NPMRC_PATH), GH)
	writeFileSync(path.join(root, LOCKFILE_PATH), LOCKFILE)
	writeFileSync(
		path.join(root, 'package.json'),
		'{"devDependencies":{"@joshuafolkken/kit":"1.2.3"}}',
	)

	return root
}

function dependencies(): MigrationDependencies {
	return {
		fetch_version: vi.fn().mockResolvedValue('sha512-public'),
		install: vi.fn().mockResolvedValue(undefined),
		effective_registry: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
		user_npmrc: '',
		environment: {},
	}
}

afterEach(() => {
	for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('registry migration success', () => {
	it('migrates a kit-only project and is idempotent', async () => {
		const root = fixture()
		const adapters = dependencies()

		adapters.install = vi.fn().mockImplementation(() => {
			const lockfile = readFileSync(path.join(root, LOCKFILE_PATH), 'utf8')

			expect(lockfile).toContain('integrity: sha512-public')
		})
		const first = await registry_migration.migrate(root, adapters)
		const second = await registry_migration.migrate(root, adapters)

		expect(first).toContain('Migrated')
		expect(second).toContain('Already using public npm')
		expect(readFileSync(path.join(root, NPMRC_PATH), 'utf8')).toContain(PUBLIC_HOST)
	})
})

describe('registry migration refusals', () => {
	it('leaves settings untouched when the version is unpublished', async () => {
		const root = fixture()
		const adapters = dependencies()

		adapters.fetch_version = vi.fn().mockResolvedValue(undefined)
		expect(await registry_migration.migrate(root, adapters)).toContain('unpublished on npm')
		expect(readFileSync(path.join(root, NPMRC_PATH), 'utf8')).toBe(GH)
		expect(adapters.install).not.toHaveBeenCalled()
	})

	it('restores settings and lockfile when resolution still points to GitHub', async () => {
		const root = fixture()
		const adapters = dependencies()

		adapters.install = vi.fn().mockImplementation(() => {
			writeFileSync(path.join(root, LOCKFILE_PATH), LOCKFILE)
		})
		const result = await registry_migration.migrate(root, adapters)

		expect(result).toContain(RESTORED)
		expect(readFileSync(path.join(root, NPMRC_PATH), 'utf8')).toBe(GH)
		expect(readFileSync(path.join(root, LOCKFILE_PATH), 'utf8')).toBe(LOCKFILE)
	})

	it('blocks an environment registry override', async () => {
		const root = fixture()
		const adapters = dependencies()

		adapters.environment = Object.fromEntries([
			['npm_config_@joshuafolkken:registry', 'https://npm.pkg.github.com'],
		])
		expect(await registry_migration.migrate(root, adapters)).toContain('environment override')
		expect(readFileSync(path.join(root, NPMRC_PATH), 'utf8')).toBe(GH)
	})
})

describe('registry migration rollback', () => {
	it('restores an unrelated workspace config written by pnpm', async () => {
		const root = fixture()
		const adapters = dependencies()
		const workspace_path = path.join(root, 'pnpm-workspace.yaml')

		adapters.install = vi.fn().mockImplementation(() => {
			writeFileSync(workspace_path, 'packages: []\n')
		})
		const result = await registry_migration.migrate(root, adapters)

		expect(result).toContain(RESTORED)
		expect(existsSync(workspace_path)).toBe(false)
		expect(readFileSync(path.join(root, NPMRC_PATH), 'utf8')).toBe(GH)
	})
})
