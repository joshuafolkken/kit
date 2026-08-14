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

// Playwright never restarts a `webServer` that exits mid-run, so once it dies every remaining test
// fails with the identical net::ERR_CONNECTION_REFUSED — and is retried twice against the same
// closed port. Uncapped, one such run burned six minutes producing 186 indistinguishable failures
// in which the only meaningful event, the server's death, was invisible. A test counts toward this
// cap only after its retries are exhausted, so 10 still reports a genuine multi-test regression in
// full while ending a dead-server run in seconds. Do not raise or remove it without that tradeoff.
const CI_MAX_FAILURES = 10

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

// `is_ci_enabled` only decides what this config returns; Playwright's own modules read
// `process.env['CI']` directly with the bare truthiness it replaces, so an explicit opt-out such as
// `CI=0` still reads as CI to them. The visible casualty is the HTML reporter's `onExit`, which
// suppresses both the auto-open on failure and the "To open last HTML report run:" hint — a local
// run whose report is unreachable unless the developer already knows `playwright show-report`.
// (`CI/1` in the Playwright user agent and the MCP headless force share the same root cause.)
// Deleting the variable once this config has judged the run local is what makes every downstream
// reader agree with that verdict, the `pnpm run dev` child process included: leaving `CI=0` set for
// the child would only re-introduce the same bare-truthiness bug one process down. The guard is
// what keeps this safe — a real provider value such as `CI=woodpecker` is never touched, and the
// deletion cannot fire on the CI branch.
if (!IS_CI) delete process.env['CI']

// Set PLAYWRIGHT_REUSE_SERVER=1 (or 'true' / 'yes' / 'on') when the server already listening on the
// port below is known to be this project's: Playwright then reuses it and skips its webServer
// command (no boot, no rebuild). Any other value — including '0', 'false', 'off', empty and unset
// (default) — makes Playwright boot its own server on both branches, and abort if the port is taken.
// The default matters most locally: DEV_PORT is vite's default, so every vite project lands on it
// first and later ones drift to 5174, 5178, … With reuse on, Playwright would adopt whichever
// foreign app got there first and — baseURL being derived from this port — run the whole suite
// green against it. Failing on a busy port replaces a silent pass against the wrong application.
const IS_REUSE_ENABLED = is_flag_enabled(process.env['PLAYWRIGHT_REUSE_SERVER'])

const web_server_config = IS_CI
	? {
			command: 'pnpm run build && pnpm run preview',
			port: PREVIEW_PORT,
			timeout: CI_TIMEOUT,
			reuseExistingServer: IS_REUSE_ENABLED,
		}
	: {
			command: 'pnpm run dev',
			port: DEV_PORT,
			timeout: LOCAL_TIMEOUT,
			reuseExistingServer: IS_REUSE_ENABLED,
		}

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
	...(IS_CI ? { workers: CI_WORKERS, maxFailures: CI_MAX_FAILURES } : {}),
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
