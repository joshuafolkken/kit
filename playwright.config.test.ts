import { afterEach, describe, expect, it, vi } from 'vitest'

const CI_KEY = 'CI'
const REUSE_KEY = 'PLAYWRIGHT_REUSE_SERVER'
const CI_ON = '1'

const ENABLING_VALUES = ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON', ' 1 ']
const DISABLING_VALUES = ['0', 'false', '', 'off', 'no', 'FALSE', 'Off', ' 0 ', 'maybe']

const CI_VALUES = ['true', '1', 'yes', 'on', 'woodpecker', ' TRUE ']
const NOT_CI_VALUES = ['0', 'false', 'no', 'off', '', ' FALSE ', '  ']

const DEV_COMMAND = 'pnpm run dev'
const PREVIEW_COMMAND = 'pnpm run build && pnpm run preview'
const DEV_PORT = 5173
const PREVIEW_PORT = 4173

interface WebServer {
	command?: string
	port?: number
	reuseExistingServer?: boolean
}

// Re-imports the config so its module-level env reads run again with the values under test.
async function load_web_server(
	ci: string | undefined,
	flag: string | undefined,
): Promise<WebServer> {
	vi.stubEnv(CI_KEY, ci)
	vi.stubEnv(REUSE_KEY, flag)
	vi.resetModules()
	const { default: config } = await import('#playwright-config')
	const { webServer: web_server } = config
	if (web_server === undefined || Array.isArray(web_server)) return {}

	return web_server
}

async function load_reuse_existing_server(
	ci: string | undefined,
	flag: string | undefined,
): Promise<boolean | undefined> {
	const web_server = await load_web_server(ci, flag)

	return web_server.reuseExistingServer
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

// Regression guard for #775: env vars are strings, so the previous `Boolean()` read turned
// PLAYWRIGHT_REUSE_SERVER=0 and =false into reuse. A CI run that then binds to an already-running
// dev server makes app-kit's security-header E2E skip itself and still report green.
describe('playwright.config webServer reuseExistingServer', () => {
	it.each(ENABLING_VALUES)('enables reuse in CI for %j', async (value) => {
		expect(await load_reuse_existing_server(CI_ON, value)).toBe(true)
	})

	it.each(DISABLING_VALUES)('disables reuse in CI for %j', async (value) => {
		expect(await load_reuse_existing_server(CI_ON, value)).toBe(false)
	})

	it('disables reuse in CI when the flag is unset', async () => {
		expect(await load_reuse_existing_server(CI_ON, undefined)).toBe(false)
	})

	it('keeps reusing the dev server outside CI regardless of the flag', async () => {
		expect(await load_reuse_existing_server(undefined, '0')).toBe(true)
	})
})

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
