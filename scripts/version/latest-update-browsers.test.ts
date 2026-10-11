import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `josh latest` moves `@playwright/test`, and a moved version cannot launch the browsers the previous
// one downloaded (joshuafolkken/kit#3675). These tests drive `main` across an update that bumps the
// installed package and pin when the browser install runs.

const LOCKFILE_PATH = 'pnpm-lock.yaml'
const PLAYWRIGHT_MANIFEST_RE = /@playwright.test.package\.json$/u
const MANIFEST = '{"devDependencies":{"@playwright/test":"^1.63.0"}}'
const DOWNGRADED_MANIFEST = '{"devDependencies":{"@playwright/test":"^1.62.0"}}'
const PREVIOUS_VERSION = '1.63.0'
const BUMPED_VERSION = '1.64.0'
const INSTALL_COMMAND = ['exec', 'playwright', 'install', 'chromium']
const UPDATE_FAILURE_STATUS = 3
const PLAN = '  Install location:    /cache/ms-playwright/chromium-1248\n'

const tree = { package_json: MANIFEST, installed: PREVIOUS_VERSION, install_status: 0 }

const read_mock = vi.hoisted(() => vi.fn())
const execa_sync_mock = vi.hoisted(() =>
	vi.fn<
		(cmd: string, arguments_: ReadonlyArray<string>) => { exitCode: number; stdout?: string }
	>(),
)
const exists_mock = vi.hoisted(() => vi.fn<(path: string) => boolean>())
const sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({
	readFileSync: read_mock,
	existsSync: exists_mock,
	writeFileSync: vi.fn(),
	mkdtempSync: vi.fn().mockReturnValue('cache-directory-fixture'),
	rmSync: vi.fn(),
}))
vi.mock('./safe-chain-version-update', () => ({
	safe_chain_version_update: { sync: sync_mock },
}))
vi.mock('#scripts/overrides/overrides-files', () => ({
	overrides_files: {
		read_current_sources: vi.fn().mockReturnValue({ package_json: '{}', workspace_yaml: '' }),
		read_current_overrides: vi.fn().mockReturnValue({}),
	},
}))

const { latest_update } = await import('./latest-update')

function read_tree(path: string): string {
	if (PLAYWRIGHT_MANIFEST_RE.test(path)) return JSON.stringify({ version: tree.installed })

	return path === LOCKFILE_PATH ? '' : tree.package_json
}

function is_dry_run(arguments_: ReadonlyArray<string>): boolean {
	return arguments_.includes('--dry-run')
}

function is_install(arguments_: ReadonlyArray<string>): boolean {
	return arguments_.includes('playwright') && !is_dry_run(arguments_)
}

function count_installs(): number {
	return execa_sync_mock.mock.calls.filter(([, arguments_]) => is_install(arguments_)).length
}

// The update stages move the installed version; the install command answers the arranged status.
function arrange_update(installed_after: string, update_status = 0): void {
	execa_sync_mock.mockImplementation((_cmd: string, arguments_: ReadonlyArray<string>) => {
		if (is_install(arguments_)) return { exitCode: tree.install_status }
		if (is_dry_run(arguments_)) return { exitCode: 0, stdout: PLAN }
		tree.installed = installed_after

		return { exitCode: update_status }
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubEnv('JOSH_PLAYWRIGHT_BROWSERS', '')
	Object.assign(tree, { package_json: MANIFEST, installed: PREVIOUS_VERSION, install_status: 0 })
	read_mock.mockImplementation(read_tree)
	exists_mock.mockReturnValue(true)
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	vi.spyOn(console, 'error').mockImplementation(() => {
		/* suppress */
	})
})

afterEach(() => {
	process.exitCode = undefined
})

describe('latest_update.main — an update that bumps @playwright/test', () => {
	it('installs the browsers of the new version', () => {
		arrange_update(BUMPED_VERSION)
		latest_update.main()

		expect(execa_sync_mock).toHaveBeenLastCalledWith('pnpm', INSTALL_COMMAND, expect.anything())
		expect(process.exitCode).toBeUndefined()
	})

	it('exits non-zero when the browser install fails', () => {
		tree.install_status = 1
		arrange_update(BUMPED_VERSION)
		latest_update.main()

		expect(process.exitCode).toBe(1)
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining('Playwright browser install failed'),
		)
	})
})

describe('latest_update.main — when the browser install must not run', () => {
	it('runs no install when @playwright/test did not move', () => {
		arrange_update(PREVIOUS_VERSION)
		latest_update.main()

		expect(count_installs()).toBe(0)
		expect(sync_mock).toHaveBeenCalledOnce()
	})

	// The rerun after an install that failed: the version no longer moves, the browsers still do.
	it('installs the browsers an earlier run left missing though the version did not move', () => {
		exists_mock.mockReturnValue(false)
		arrange_update(PREVIOUS_VERSION)
		latest_update.main()

		expect(count_installs()).toBe(1)
	})

	it('runs no install when the update failed before moving @playwright/test', () => {
		arrange_update(PREVIOUS_VERSION, UPDATE_FAILURE_STATUS)
		latest_update.main()

		expect(count_installs()).toBe(0)
		expect(sync_mock).not.toHaveBeenCalled()
	})
})

// `node_modules` carries the bumped package however the update ended, and the browser tests that
// run next launch that one.
describe('latest_update.main — an update that moved @playwright/test and did not settle', () => {
	it('installs the browsers when a later stage of the update failed', () => {
		arrange_update(BUMPED_VERSION, UPDATE_FAILURE_STATUS)
		latest_update.main()

		expect(count_installs()).toBe(1)
		expect(sync_mock).not.toHaveBeenCalled()
	})

	// A rollback restores the manifest and the lockfile only; the bumped package stays installed.
	it('installs the browsers after a rollback', () => {
		execa_sync_mock.mockImplementation(() => {
			tree.package_json = DOWNGRADED_MANIFEST
			tree.installed = BUMPED_VERSION

			return { exitCode: 0 }
		})
		latest_update.main()

		expect(count_installs()).toBe(1)
		expect(sync_mock).not.toHaveBeenCalled()
	})
})
