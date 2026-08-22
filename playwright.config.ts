import { environment_flags } from '@joshuafolkken/kit/env'
import { ports } from '@joshuafolkken/kit/ports'
import { defineConfig, devices, type ReporterDescription } from '@playwright/test'

// Both ports come from kit's single definition (`@joshuafolkken/kit/ports`), offset by the personal
// `PORT_SEED` in `.env` so several kit projects on one machine can each own a pair. An unset or
// blank seed — the default, and the CI case — reproduces the historical vite / wrangler defaults
// exactly. An invalid seed throws here rather than serving a default port, which would silently put
// two projects back on one port.
//
// Playwright loads this config itself, so nothing on the way in has read `.env`. Reading it here is
// what makes this config and `josh port` agree — the command calls the same loader — and without it
// the seed reached `josh port` alone, so a consumer wiring its `preview` script through
// `josh port preview` as documented lost the whole suite to a webServer timeout (#820). The loader
// applies only the settings this config reads and leaves the rest of `.env` out of the environment
// the webServer child inherits (#826). A variable already set in the environment still wins over
// the file, and a project with no `.env` is untouched.
//
// The working directory is the anchor, and the loader ascends from it to the project root — the
// same root `pnpm run` hands the `webServer` command, so both sides name one file from anywhere
// inside the project. The one layout that escapes that is a run whose working directory sits in a
// *different* package from this config, as `playwright test --config ../../playwright.config.ts`
// does in a workspace: Playwright would default `webServer.cwd` to this file's directory while the
// seed came from the other package's `.env`. No kit-distributed project has that shape — this
// config is written to a project root — so the anchor stays where every documented entry point
// puts it.
ports.load_environment_file()

const DEV_PORT = ports.resolve_development_port()
const PREVIEW_PORT = ports.resolve_preview_port()

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

// The flag vocabulary lives in `@joshuafolkken/kit/env` (#828) — one exported predicate, so this
// config and every consumer config that adds an env-driven toggle agree on what "switched on"
// means instead of each declaring its own set and drifting.
const IS_CI = environment_flags.is_ci_enabled(process.env['CI'])

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
// The default matters most locally: with no `PORT_SEED` set, DEV_PORT is vite's default, so every
// vite project lands on it first and later ones drift onward. With reuse on, Playwright would adopt
// whichever foreign app got there first and — baseURL being derived from this port — run the whole
// suite green against it. Failing on a busy port replaces a silent pass against the wrong
// application; a seed reduces how often a foreign server is on the port at all.
const IS_REUSE_ENABLED = environment_flags.is_flag_enabled(process.env['PLAYWRIGHT_REUSE_SERVER'])

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
