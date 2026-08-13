import { defineConfig, devices, type ReporterDescription } from '@playwright/test'

const DEV_PORT = 5173
const PREVIEW_PORT = 4173

const CI_TIMEOUT = 120_000
const LOCAL_TIMEOUT = 30_000
const CI_TEST_TIMEOUT = 30_000
const ACTION_TIMEOUT = 10_000
const NAV_TIMEOUT = 30_000
const CI_WORKERS = 2
const CI_RETRIES = 2

type EnvConfig = {
	retries: number
	timeout: number
	launch_args: string[]
	screenshot: 'only-on-failure' | 'off'
	video: 'retain-on-failure' | 'off'
	trace: 'retain-on-failure' | 'off'
	reporter: ReporterDescription[]
}

const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off'])

function normalize_flag_value(value: string): string {
	return value.trim().toLowerCase()
}

// Env vars are always strings, so `Boolean(value)` would enable the flag for '0' and 'false' too —
// the two spellings someone reaches for to turn it off. Only affirmative spellings enable.
function is_flag_enabled(value: string | undefined): boolean {
	return value !== undefined && TRUTHY_FLAG_VALUES.has(normalize_flag_value(value))
}

// `CI` is not an opt-in flag with a fixed vocabulary — Woodpecker exports `CI=woodpecker` — so the
// affirmative allow-list above would drop such runs into dev mode. Invert the test instead: any
// value counts as CI except an empty one and the explicit negatives. (`ci-info` opts out on the
// exact string 'false' alone; the negative set here also covers '0', 'no' and 'off'.)
function is_ci_enabled(value: string | undefined): boolean {
	if (value === undefined) return false
	const normalized = normalize_flag_value(value)

	return normalized.length > 0 && !FALSY_FLAG_VALUES.has(normalized)
}

const IS_CI = is_ci_enabled(process.env['CI'])

// Set PLAYWRIGHT_REUSE_SERVER=1 (or 'true' / 'yes' / 'on') when an orchestrator pre-builds and
// boots the preview so several checks share one server: Playwright then reuses the running server
// and skips its webServer command (no rebuild). Any other value — including '0', 'false', 'off',
// empty and unset (default) — keeps CI booting a fresh server and dev reusing, as before.
const web_server_config = IS_CI
	? {
			command: 'pnpm run build && pnpm run preview',
			port: PREVIEW_PORT,
			timeout: CI_TIMEOUT,
			reuseExistingServer: is_flag_enabled(process.env['PLAYWRIGHT_REUSE_SERVER']),
		}
	: { command: 'pnpm run dev', port: DEV_PORT, timeout: LOCAL_TIMEOUT, reuseExistingServer: true }

const env_config: EnvConfig = IS_CI
	? {
			retries: CI_RETRIES,
			timeout: CI_TEST_TIMEOUT,
			launch_args: ['--disable-dev-shm-usage', '--no-sandbox'],
			screenshot: 'only-on-failure',
			video: 'retain-on-failure',
			trace: 'retain-on-failure',
			reporter: [['html'], ['github']],
		}
	: {
			retries: 0,
			timeout: LOCAL_TIMEOUT,
			launch_args: [],
			screenshot: 'off',
			video: 'off',
			trace: 'off',
			reporter: [['html'], ['list']],
		}

export default defineConfig({
	webServer: web_server_config,
	testMatch: '**/*.e2e.{ts,js}',
	fullyParallel: true,
	...(IS_CI ? { workers: CI_WORKERS } : {}),
	retries: env_config.retries,
	timeout: env_config.timeout,
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					args: env_config.launch_args,
				},
			},
		},
	],
	reporter: env_config.reporter,
	use: {
		actionTimeout: ACTION_TIMEOUT,
		navigationTimeout: NAV_TIMEOUT,
		screenshot: env_config.screenshot,
		video: env_config.video,
		trace: env_config.trace,
	},
})
