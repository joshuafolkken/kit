import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn())
const exists_mock = vi.hoisted(() => vi.fn<(path: string) => boolean>())
const execa_sync_mock = vi.hoisted(() =>
	vi.fn<
		(cmd: string, arguments_: ReadonlyArray<string>) => { exitCode?: number; stdout?: string }
	>(),
)

vi.mock('node:fs', () => ({ readFileSync: read_mock, existsSync: exists_mock }))
vi.mock('execa', () => ({ execaSync: execa_sync_mock }))

const { playwright_browsers } = await import('./playwright-browsers')

const PREVIOUS_VERSION = '1.63.0'
const BUMPED_VERSION = '1.64.0'
const INSTALL_ARGS = ['exec', 'playwright', 'install']
const INSTALL_FAILURE_STATUS = 7
const DRY_RUN_FLAG = '--dry-run'
const COMPLETE_MARKER_RE = /chromium-1248.INSTALLATION_COMPLETE$/u
const PLAN = [
	'Chrome for Testing 156.0.8078.4 (playwright chromium v1248)',
	'  Install location:    /cache/ms-playwright/chromium-1248',
	'  Download url:        https://cdn.playwright.dev/builds/chrome-mac-arm64.zip',
	'',
].join('\n')
const SYSTEM_PLAN = 'Google Chrome (playwright chrome)\n  Install location:    <system>\n'

// The dry run answers the arranged plan; the install itself succeeds.
function arrange_plan(stdout: string, exit_code = 0): void {
	execa_sync_mock.mockImplementation((_cmd: string, arguments_: ReadonlyArray<string>) =>
		arguments_.includes(DRY_RUN_FLAG) ? { exitCode: exit_code, stdout } : { exitCode: 0 },
	)
}

function count_installs(): number {
	const { calls } = execa_sync_mock.mock

	return calls.filter(([, arguments_]) => !arguments_.includes(DRY_RUN_FLAG)).length
}

function install_manifest(version: string): void {
	read_mock.mockReturnValue(JSON.stringify({ name: '@playwright/test', version }))
}

function uninstall_package(): void {
	read_mock.mockImplementation(() => {
		throw Object.assign(new Error('absent'), { code: 'ENOENT' })
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	execa_sync_mock.mockReturnValue({ exitCode: 0 })
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	vi.spyOn(console, 'error').mockImplementation(() => {
		/* suppress */
	})
})

describe('playwright_browsers.read_installed_version', () => {
	it('reads the version from the installed package manifest', () => {
		install_manifest(BUMPED_VERSION)

		expect(playwright_browsers.read_installed_version()).toBe(BUMPED_VERSION)
		expect(read_mock).toHaveBeenCalledWith(
			expect.stringMatching(/node_modules.@playwright.test.package\.json$/u),
			'utf8',
		)
	})

	it('answers undefined when the package is not installed', () => {
		uninstall_package()

		expect(playwright_browsers.read_installed_version()).toBeUndefined()
	})

	it('answers undefined for a manifest that is not JSON', () => {
		read_mock.mockReturnValue('not json')

		expect(playwright_browsers.read_installed_version()).toBeUndefined()
	})
})

describe('playwright_browsers.resolve_browsers', () => {
	it('defaults to chromium when the variable is unset', () => {
		expect(playwright_browsers.resolve_browsers({})).toEqual(['chromium'])
	})

	it('reads a space-separated list from JOSH_PLAYWRIGHT_BROWSERS', () => {
		const environment = { JOSH_PLAYWRIGHT_BROWSERS: ' chromium  firefox webkit ' }

		expect(playwright_browsers.resolve_browsers(environment)).toEqual([
			'chromium',
			'firefox',
			'webkit',
		])
	})

	// A dropped name must never turn into an option handed to the install command.
	it('drops a name that starts with a dash', () => {
		const environment = { JOSH_PLAYWRIGHT_BROWSERS: '--with-deps chromium-headless-shell' }

		expect(playwright_browsers.resolve_browsers(environment)).toEqual(['chromium-headless-shell'])
	})

	// As the CI workflow does: Playwright then rejects the unknown name at the install, where the
	// mistake is, instead of the list being silently narrowed to chromium.
	it('keeps a mistyped name, stripped of its unsafe characters, for the install to reject', () => {
		const environment = { JOSH_PLAYWRIGHT_BROWSERS: 'Chromium web_kit' }

		expect(playwright_browsers.resolve_browsers(environment)).toEqual(['Chromium', 'webkit'])
	})

	it('falls back to chromium when no usable name is left', () => {
		expect(playwright_browsers.resolve_browsers({ JOSH_PLAYWRIGHT_BROWSERS: '; --all' })).toEqual([
			'chromium',
		])
	})
})

describe('playwright_browsers.install_when_needed — a moved version', () => {
	beforeEach(() => {
		vi.stubEnv('JOSH_PLAYWRIGHT_BROWSERS', '')
		install_manifest(BUMPED_VERSION)
	})

	it('installs chromium for the new version', () => {
		const status = playwright_browsers.install_when_needed(PREVIOUS_VERSION)

		expect(status).toBe(0)
		expect(execa_sync_mock).toHaveBeenCalledWith(
			'pnpm',
			[...INSTALL_ARGS, 'chromium'],
			expect.objectContaining({ stdio: 'inherit', reject: false }),
		)
	})

	it('installs the browsers when the package was added by this update', () => {
		playwright_browsers.install_when_needed(undefined)

		expect(execa_sync_mock).toHaveBeenCalledOnce()
	})

	it('installs the browsers JOSH_PLAYWRIGHT_BROWSERS names', () => {
		vi.stubEnv('JOSH_PLAYWRIGHT_BROWSERS', 'chromium firefox')
		playwright_browsers.install_when_needed(PREVIOUS_VERSION)

		expect(execa_sync_mock).toHaveBeenCalledWith(
			'pnpm',
			[...INSTALL_ARGS, 'chromium', 'firefox'],
			expect.anything(),
		)
	})
})

describe('playwright_browsers.install_when_needed — nothing to install', () => {
	it('installs nothing when the version did not move and its browsers are complete', () => {
		install_manifest(PREVIOUS_VERSION)
		arrange_plan(PLAN)
		exists_mock.mockReturnValue(true)

		expect(playwright_browsers.install_when_needed(PREVIOUS_VERSION)).toBe(0)
		expect(count_installs()).toBe(0)
		expect(exists_mock).toHaveBeenCalledWith(expect.stringMatching(COMPLETE_MARKER_RE))
	})

	// A branded channel lives outside Playwright's cache, so there is no directory to find missing.
	it('installs nothing for an unmoved version whose browser is a system channel', () => {
		install_manifest(PREVIOUS_VERSION)
		arrange_plan(SYSTEM_PLAN)

		expect(playwright_browsers.install_when_needed(PREVIOUS_VERSION)).toBe(0)
		expect(count_installs()).toBe(0)
	})

	it('runs nothing in a repository without @playwright/test', () => {
		uninstall_package()

		expect(playwright_browsers.install_when_needed(undefined)).toBe(0)
		expect(execa_sync_mock).not.toHaveBeenCalled()
	})
})

// The run after a failed or interrupted install: the version is the same on both sides of the
// update, and the browsers are still not there.
describe('playwright_browsers.install_when_needed — an unmoved version missing its browsers', () => {
	beforeEach(() => {
		vi.stubEnv('JOSH_PLAYWRIGHT_BROWSERS', '')
		install_manifest(BUMPED_VERSION)
		exists_mock.mockReturnValue(false)
	})

	it('installs a browser whose directory was never completed', () => {
		arrange_plan(PLAN)

		expect(playwright_browsers.install_when_needed(BUMPED_VERSION)).toBe(0)
		expect(execa_sync_mock).toHaveBeenLastCalledWith(
			'pnpm',
			[...INSTALL_ARGS, 'chromium'],
			expect.objectContaining({ stdio: 'inherit' }),
		)
	})

	it('runs the install when Playwright refuses the plan, so the refusal is reported', () => {
		arrange_plan('', 1)
		playwright_browsers.install_when_needed(BUMPED_VERSION)

		expect(count_installs()).toBe(1)
	})
})

describe('playwright_browsers.install_when_needed — a failed install', () => {
	beforeEach(() => {
		vi.stubEnv('JOSH_PLAYWRIGHT_BROWSERS', '')
		install_manifest(BUMPED_VERSION)
		execa_sync_mock.mockReturnValue({ exitCode: INSTALL_FAILURE_STATUS })
	})

	it('answers a non-zero status', () => {
		expect(playwright_browsers.install_when_needed(PREVIOUS_VERSION)).toBe(1)
	})

	it('names the step that failed and its exit status', () => {
		playwright_browsers.install_when_needed(PREVIOUS_VERSION)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining('pnpm exec playwright install chromium exited 7'),
		)
	})

	it('fails when the command reports no exit status', () => {
		execa_sync_mock.mockReturnValue({})

		expect(playwright_browsers.install_when_needed(PREVIOUS_VERSION)).toBe(1)
	})
})
