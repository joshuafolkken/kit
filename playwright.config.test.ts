import { afterEach, describe, expect, it, vi } from 'vitest'

const CI_KEY = 'CI'
const REUSE_KEY = 'PLAYWRIGHT_REUSE_SERVER'
const CI_ON = '1'

const ENABLING_VALUES = ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON', ' 1 ']
const DISABLING_VALUES = ['0', 'false', '', 'off', 'no', 'FALSE', 'Off', ' 0 ', 'maybe']

// Re-imports the config so its module-level env reads run again with the values under test.
async function load_reuse_existing_server(
	ci: string | undefined,
	flag: string | undefined,
): Promise<boolean | undefined> {
	vi.stubEnv(CI_KEY, ci)
	vi.stubEnv(REUSE_KEY, flag)
	vi.resetModules()
	const { default: config } = await import('#playwright-config')
	const { webServer: web_server } = config
	if (web_server === undefined || Array.isArray(web_server)) return undefined

	return web_server.reuseExistingServer
}

// Regression guard for #775: env vars are strings, so the previous `Boolean()` read turned
// PLAYWRIGHT_REUSE_SERVER=0 and =false into reuse. A CI run that then binds to an already-running
// dev server makes app-kit's security-header E2E skip itself and still report green.
describe('playwright.config webServer reuseExistingServer', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.resetModules()
	})

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
