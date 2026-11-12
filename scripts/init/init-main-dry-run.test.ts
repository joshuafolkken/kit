import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const make_directory = temporary_directory()

// Same import-time paths as the other `init` integration tests, so the same getter mock
// (joshuafolkken/kit#879).
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
vi.mock('execa', () => ({ execaSync: vi.fn() }))

const PLAN = 'the plan'
const PACKAGE_JSON = 'package.json'

beforeEach(() => {
	vi.resetModules()
	paths_mock.package_dir = fileURLToPath(new URL('../../', import.meta.url))
	paths_mock.root = make_directory('josh-init-main-dry-run-')
	writeFileSync(path.join(paths_mock.root, PACKAGE_JSON), '{"name":"example"}\n')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh init --dry-run (#3830)', () => {
	it('prints the plan, writes nothing and reports that nothing was set up', async () => {
		const { init_dry_run } = await import('./init-dry-run')
		const { main } = await import('./init')

		vi.spyOn(init_dry_run, 'plan_report').mockReturnValue(PLAN)

		expect(main(['--profile', 'basic', '--dry-run'])).toBe(false)
		expect(init_dry_run.plan_report).toHaveBeenCalledWith({
			root: paths_mock.root,
			profile: 'basic',
			has_git: false,
			is_install: true,
		})
		expect(console.info).toHaveBeenCalledWith(PLAN)
		expect(readdirSync(paths_mock.root)).toStrictEqual([PACKAGE_JSON])
	})

	it('carries --no-install into the plan', async () => {
		const { init_dry_run } = await import('./init-dry-run')
		const { main } = await import('./init')

		vi.spyOn(init_dry_run, 'plan_report').mockReturnValue(PLAN)
		main(['--dry-run', '--no-install'])

		expect(init_dry_run.plan_report).toHaveBeenCalledWith(
			expect.objectContaining({ profile: undefined, is_install: false }),
		)
	})
})
