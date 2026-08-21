import type { PlaywrightTestConfig } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

const CI_KEY = 'CI'
const REUSE_KEY = 'PLAYWRIGHT_REUSE_SERVER'
const CI_ON = '1'

const EXPECTED_MAX_FAILURES = 10
// A dead server must not be able to hide behind a cap so low that a real regression is truncated,
// nor so high that the cascade it exists to stop runs on for minutes.
const MIN_USEFUL_MAX_FAILURES = 5
const MAX_USEFUL_MAX_FAILURES = 20

const ENABLING_VALUES = ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON', ' 1 ']
const DISABLING_VALUES = ['0', 'false', '', 'off', 'no', 'FALSE', 'Off', ' 0 ', 'maybe']

const CI_VALUES = ['true', '1', 'yes', 'on', 'woodpecker', ' TRUE ']
const NOT_CI_VALUES = ['0', 'false', 'no', 'off', '', ' FALSE ', '  ']

const DEV_COMMAND = 'pnpm run dev'
const PREVIEW_COMMAND = 'pnpm run build && pnpm run preview'
const DEV_PORT = 5173
const PREVIEW_PORT = 4173
const SEED_KEY = 'PORT_SEED'
const SEED = 1
const INVALID_SEED = 'abc'

interface WebServer {
	command?: string
	port?: number
	reuseExistingServer?: boolean
}

// Re-imports the config so its module-level env reads run again with the values under test.
async function import_config(
	ci: string | undefined,
	flag: string | undefined,
): Promise<PlaywrightTestConfig> {
	vi.stubEnv(CI_KEY, ci)
	vi.stubEnv(REUSE_KEY, flag)
	vi.resetModules()
	const { default: config } = await import('#playwright-config')

	return config
}

async function load_web_server(
	ci: string | undefined,
	flag: string | undefined,
): Promise<WebServer> {
	const { webServer: web_server } = await import_config(ci, flag)
	if (web_server === undefined || Array.isArray(web_server)) return {}

	return web_server
}

async function load_max_failures(ci: string | undefined): Promise<number | undefined> {
	const { maxFailures: max_failures } = await import_config(ci, undefined)

	return max_failures
}

async function load_reuse_existing_server(
	ci: string | undefined,
	flag: string | undefined,
): Promise<boolean | undefined> {
	const web_server = await load_web_server(ci, flag)

	return web_server.reuseExistingServer
}

async function load_seeded_web_server(
	ci: string | undefined,
	seed: string | undefined,
): Promise<WebServer> {
	vi.stubEnv(SEED_KEY, seed)

	return await load_web_server(ci, undefined)
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

// Both branches read one flag, so both are held to one table — running it twice is what proves the
// semantics are identical rather than merely similar.
// Regression guard for #775 (CI branch): env vars are strings, so the original `Boolean()` read
// turned PLAYWRIGHT_REUSE_SERVER=0 and =false into reuse, and a CI run binding to an already-running
// dev server makes app-kit's security-header E2E skip itself and still report green.
// Regression guard for #784 (local branch): it reused unconditionally on DEV_PORT — vite's default,
// hence the port every vite project takes first. Playwright then skipped its own dev server, derived
// baseURL from that port and ran the whole suite green against whatever foreign app was listening.
const REUSE_BRANCHES = [
	{ label: 'in CI', ci: CI_ON },
	{ label: 'outside CI', ci: undefined },
]

describe.each(REUSE_BRANCHES)(
	'playwright.config webServer reuseExistingServer $label',
	({ ci }) => {
		it.each(ENABLING_VALUES)('enables reuse for %j', async (value) => {
			expect(await load_reuse_existing_server(ci, value)).toBe(true)
		})

		it.each(DISABLING_VALUES)('disables reuse for %j', async (value) => {
			expect(await load_reuse_existing_server(ci, value)).toBe(false)
		})

		it('disables reuse when the flag is unset', async () => {
			expect(await load_reuse_existing_server(ci, undefined)).toBe(false)
		})
	},
)

// Regression guard for #777: the previous `Boolean(process.env['CI'])` read selected the CI branch
// for CI=0 and CI=false, so a developer opting out locally got build && preview on port 4173.
// The inverse predicate must still keep non-boolean provider values such as CI=woodpecker on CI.
describe('playwright.config CI branch selection', () => {
	it.each(CI_VALUES)('selects the CI webServer for CI=%j', async (value) => {
		const web_server = await load_web_server(value, undefined)

		expect(web_server.command).toBe(PREVIEW_COMMAND)
		expect(web_server.port).toBe(PREVIEW_PORT)
	})

	it.each(NOT_CI_VALUES)('selects the local webServer for CI=%j', async (value) => {
		const web_server = await load_web_server(value, undefined)

		expect(web_server.command).toBe(DEV_COMMAND)
		expect(web_server.port).toBe(DEV_PORT)
	})

	it('selects the local webServer when CI is unset', async () => {
		const web_server = await load_web_server(undefined, undefined)

		expect(web_server.command).toBe(DEV_COMMAND)
		expect(web_server.port).toBe(DEV_PORT)
	})
})

// Regression guard for #780: #777 fixed only what the config itself returns. Playwright's own
// modules read `process.env['CI']` with the bare truthiness it replaced, so a `CI=0` run stayed CI
// to them — the HTML reporter's `onExit` printed neither the failure auto-open nor the
// "To open last HTML report run:" hint, leaving the local run's report unreachable. The config now
// deletes the variable once it has judged the run local, and must still leave a real provider value
// such as CI=woodpecker intact.
describe('playwright.config CI env normalization', () => {
	it.each(NOT_CI_VALUES)('clears CI=%j so Playwright agrees the run is local', async (value) => {
		await import_config(value, undefined)

		expect(process.env[CI_KEY]).toBeUndefined()
	})

	it.each(CI_VALUES)('leaves CI=%j intact', async (value) => {
		await import_config(value, undefined)

		expect(process.env[CI_KEY]).toBe(value)
	})

	it('leaves CI unset when it was already unset', async () => {
		await import_config(undefined, undefined)

		expect(process.env[CI_KEY]).toBeUndefined()
	})
})

// Regression guard for #782: Playwright does not restart a webServer that exits mid-run, so an
// uncapped CI run turns the server's death into hundreds of identical ERR_CONNECTION_REFUSED
// failures — six minutes of runner time, and a failure list in which the real event is invisible.
describe('playwright.config CI failure cap', () => {
	it.each(CI_VALUES)('caps the failure count in CI for CI=%j', async (value) => {
		expect(await load_max_failures(value)).toBe(EXPECTED_MAX_FAILURES)
	})

	it.each(NOT_CI_VALUES)('leaves the run uncapped for CI=%j', async (value) => {
		expect(await load_max_failures(value)).toBeUndefined()
	})

	it('leaves the run uncapped when CI is unset', async () => {
		expect(await load_max_failures(undefined)).toBeUndefined()
	})

	it('keeps the cap high enough to report a real multi-test regression in full', async () => {
		const max_failures = await load_max_failures(CI_ON)

		expect(max_failures).toBeGreaterThanOrEqual(MIN_USEFUL_MAX_FAILURES)
		expect(max_failures).toBeLessThanOrEqual(MAX_USEFUL_MAX_FAILURES)
	})
})

// #818: every kit consumer used to land on the same 5173 / 4173, so two projects could not run
// their servers at once and the second one drifted onto an unpredictable port. Both ports now come
// from kit's single definition offset by PORT_SEED, and — baseURL being derived from webServer.port
// — this config is what makes the whole suite follow the seed.
describe('playwright.config PORT_SEED', () => {
	it('keeps the historical dev port when the seed is unset', async () => {
		const web_server = await load_seeded_web_server(undefined, undefined)

		expect(web_server.port).toBe(DEV_PORT)
	})

	it('keeps the historical preview port when the seed is unset', async () => {
		const web_server = await load_seeded_web_server(CI_ON, undefined)

		expect(web_server.port).toBe(PREVIEW_PORT)
	})

	it('offsets the local dev port by the seed', async () => {
		const web_server = await load_seeded_web_server(undefined, String(SEED))

		expect(web_server.port).toBe(DEV_PORT + SEED)
	})

	it('offsets the CI preview port by the same seed', async () => {
		const web_server = await load_seeded_web_server(CI_ON, String(SEED))

		expect(web_server.port).toBe(PREVIEW_PORT + SEED)
	})

	// Falling back to the shared default here would silently undo the whole point of the seed.
	it('fails to load rather than serving a default port for an invalid seed', async () => {
		await expect(load_seeded_web_server(undefined, INVALID_SEED)).rejects.toThrow(SEED_KEY)
	})
})
