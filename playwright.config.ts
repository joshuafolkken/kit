import { defineConfig, devices, type ReporterDescription } from '@playwright/test'

const IS_CI = Boolean(process.env['CI'])

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

// Set PLAYWRIGHT_REUSE_SERVER=1 when an orchestrator pre-builds and boots the preview so several
// checks share one server: Playwright then reuses the running server and skips its webServer command
// (no rebuild). Unset (default) keeps CI booting a fresh server and dev reusing, as before.
const web_server_config = IS_CI
	? {
			command: 'pnpm run build && pnpm run preview',
			port: PREVIEW_PORT,
			timeout: CI_TIMEOUT,
			reuseExistingServer: Boolean(process.env['PLAYWRIGHT_REUSE_SERVER']),
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
