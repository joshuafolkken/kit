import path from 'node:path'
import {
	self_run_guard_fixture,
	type GuardedRun,
} from '#scripts/self-sync-guard/self-run-guard-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { PACKAGE_NAME, REFUSAL_PREFIX, make_project } = self_run_guard_fixture

// `init` calls the sync writers directly, so the guard on `sync`'s own `main()` never covered it: a
// global kit run as `josh init` inside the kit checkout rewrote the distributed docs AND the
// project's `package.json` scripts and devDependencies (joshuafolkken/kit#879). Same import-time
// paths as sync, so the same mock.
const paths_mock = vi.hoisted(() => ({ PACKAGE_DIR: '', PROJECT_ROOT: '' }))

// Getters, not a spread of `paths_mock`: a spread copies the values the object held when the factory
// ran, and vitest keeps that module across `vi.resetModules()`, so the second test would run against
// the first test's directories (joshuafolkken/kit#879).
vi.mock('./init-paths', () => ({
	get PACKAGE_DIR(): string {
		return paths_mock.PACKAGE_DIR
	},
	get PROJECT_ROOT(): string {
		return paths_mock.PROJECT_ROOT
	},
	package_path: (relative_path: string): string => path.join(paths_mock.PACKAGE_DIR, relative_path),
}))

async function load_init_main(): Promise<() => void> {
	const { main } = await import('./init')

	return main
}

async function run_guarded_init(
	package_directory: string,
	project_root: string,
): Promise<GuardedRun> {
	paths_mock.PACKAGE_DIR = package_directory
	paths_mock.PROJECT_ROOT = project_root

	// Proves the mock took: unmocked, the module reads the kit checkout itself, where the guard fires
	// for a reason the temp directories had nothing to do with and every assertion passes vacuously.
	const { PROJECT_ROOT } = await import('./init-paths')

	expect(PROJECT_ROOT).toBe(project_root)

	return await self_run_guard_fixture.run_guarded_main(load_init_main, project_root)
}

beforeEach(() => {
	vi.resetModules()
	process.exitCode = undefined
})

afterEach(() => {
	vi.restoreAllMocks()
	process.exitCode = undefined
})

describe('init main — inside the package’s own repository', () => {
	it('writes nothing and exits non-zero', async () => {
		const directory = make_project(PACKAGE_NAME)
		const message = await self_run_guard_fixture.expect_refusal(
			run_guarded_init,
			directory,
			directory,
		)

		expect(message).toContain(REFUSAL_PREFIX)
	})

	// The incident #868 reproduced was a GLOBAL install run against the checkout, which `init` would
	// have reached with two unrelated directories — only the name match catches it.
	it('refuses a global install aimed at its own repository', async () => {
		const message = await self_run_guard_fixture.expect_refusal(
			run_guarded_init,
			make_project(PACKAGE_NAME),
			make_project(PACKAGE_NAME),
		)

		expect(message).toContain(PACKAGE_NAME)
	})
})
