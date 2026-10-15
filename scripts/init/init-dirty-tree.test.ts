import { readFileSync } from 'node:fs'
import path from 'node:path'
import { self_run_guard_fixture } from '#scripts/self-sync-guard/self-run-guard-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { working_tree_fixture } from './working-tree-fixture'

const { MANIFEST, committed_repository, git, remove_all, repository, write } = working_tree_fixture
const { PACKAGE_NAME, REFUSAL_PREFIX } = self_run_guard_fixture
const DIRTY_REFUSAL = 'josh init refuses to run'
const HANDOFF_ENV = 'JOSH_INIT_HANDED_OFF'
const STATUS = ['status', '--porcelain']
// A project named as kit itself, run by its own checkout: `main` stops at the self-run guard before
// writing, so a case that gets past the working-tree check shows it without setting a project up.
const SELF_MANIFEST = `${JSON.stringify({ name: PACKAGE_NAME })}\n`

// Same import-time paths as the other `init` tests, so the same getter mock (joshuafolkken/kit#879).
const paths_mock = vi.hoisted(() => ({ root: '', package_dir: '' }))

vi.mock('./init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	get PACKAGE_DIR(): string {
		return paths_mock.package_dir
	},
	package_path: (relative_path: string): string => path.join(paths_mock.package_dir, relative_path),
}))

function discard_output(): void {
	// intentionally silent
}

async function run_init(root: string): Promise<string> {
	paths_mock.root = root
	paths_mock.package_dir = root
	const error_spy = vi.spyOn(console, 'error').mockImplementation(discard_output)

	vi.spyOn(console, 'info').mockImplementation(discard_output)
	const { run_cli } = await import('./init')

	run_cli(['--no-install'])

	return error_spy.mock.calls.flat().join('\n')
}

beforeEach(() => {
	vi.resetModules()
	process.exitCode = undefined
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	process.exitCode = undefined
	remove_all()
})

describe('josh init — a working tree with uncommitted changes', () => {
	it('refuses before writing, naming the change, and leaves the tree as it was', async () => {
		const root = committed_repository()
		const edited = '{ "name": "fixture", "private": true }\n'

		write(root, MANIFEST, edited)
		const status = git(root, STATUS)
		const message = await run_init(root)

		expect(process.exitCode).toBe(1)
		expect(message).toContain(DIRTY_REFUSAL)
		expect(message).toContain(`  ${MANIFEST}`)
		expect(readFileSync(path.join(root, MANIFEST), 'utf8')).toBe(edited)
		expect(git(root, STATUS)).toBe(status)
	})

	it('leaves a handed-off run to the check its caller made', async () => {
		const root = committed_repository(SELF_MANIFEST)

		write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n')
		vi.stubEnv(HANDOFF_ENV, '1')
		const message = await run_init(root)

		expect(message).not.toContain(DIRTY_REFUSAL)
		expect(message).toContain(REFUSAL_PREFIX)
	})
})

describe('josh init — nothing uncommitted to protect', () => {
	it('runs on in a clean repository', async () => {
		const message = await run_init(committed_repository(SELF_MANIFEST))

		expect(message).not.toContain(DIRTY_REFUSAL)
		expect(message).toContain(REFUSAL_PREFIX)
	})

	it('runs on in a repository without a commit', async () => {
		const root = repository()

		write(root, MANIFEST, SELF_MANIFEST)
		const message = await run_init(root)

		expect(message).not.toContain(DIRTY_REFUSAL)
		expect(message).toContain(REFUSAL_PREFIX)
	})
})
