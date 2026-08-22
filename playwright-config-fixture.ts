import type { PlaywrightTestConfig } from '@playwright/test'
import { vi } from 'vitest'
import { environment_file_fixture } from './ports/environment-file-fixture'

// The config is a module with side effects — it reads the environment and `.env` as it loads — so
// every suite here has to re-import it under the values it wants to test. Both suites need the
// same re-import and the same isolation, so the harness lives here rather than in whichever file
// happened to need it first.

const CI_KEY = 'CI'
const REUSE_KEY = 'PLAYWRIGHT_REUSE_SERVER'
const SEED_KEY = 'PORT_SEED'
const TEMP_DIRECTORY_PREFIX = 'kit-playwright-'

interface WebServer {
	command?: string
	port?: number
	reuseExistingServer?: boolean
}

// One throwaway project per suite file, created as the fixture loads so no hook has to assign it.
// The suite removes it again from `afterAll` — `mkdtempSync` leaves the directory behind otherwise,
// and a unit run happens often enough for that to accumulate.
const PROJECT_DIRECTORY = environment_file_fixture.make_project_directory(TEMP_DIRECTORY_PREFIX)

function remove_project(): void {
	environment_file_fixture.remove_project_directory(PROJECT_DIRECTORY)
}

function write_environment_file(contents: string): void {
	environment_file_fixture.write_environment_file(PROJECT_DIRECTORY, contents)
}

// #826: `pnpm exec playwright test` run from a subdirectory left the config on seed 0 while the
// `webServer` command — which `pnpm run` executes from the package root — started on the seeded
// port. The throwaway project already carries the `package.json` that makes it a root, so pointing
// the working directory at a directory under it reproduces exactly that layout.
// The name is remembered so `restore_project` can take the directory back out: the project is
// shared by the whole file, and a leftover subdirectory would outlive the test that asked for it.
const nested_state: { name?: string } = {}

function isolate_subdirectory(name: string): void {
	nested_state.name = name
	const nested = environment_file_fixture.make_subdirectory(PROJECT_DIRECTORY, name)

	vi.spyOn(process, 'cwd').mockReturnValue(nested)
	vi.stubEnv(SEED_KEY, undefined)
}

// The config reads `.env` from the working directory, so every import runs against that empty
// project instead of this repository's own `.env`, and against a seed the suite set rather than
// one the developer happens to export. Without both, a suite would pass or fail according to the
// machine it runs on.
function isolate_project(): void {
	vi.spyOn(process, 'cwd').mockReturnValue(PROJECT_DIRECTORY)
	vi.stubEnv(SEED_KEY, undefined)
}

// `loadEnvFile` writes a real entry into `process.env`, but it lands on a key `isolate_project`
// already stubbed, so `unstubAllEnvs` takes it back out again.
function restore_project(): void {
	if (nested_state.name !== undefined) {
		environment_file_fixture.remove_subdirectory(PROJECT_DIRECTORY, nested_state.name)
		delete nested_state.name
	}

	environment_file_fixture.clear_environment_file(PROJECT_DIRECTORY)
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	vi.resetModules()
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

const playwright_config_fixture = {
	remove_project,
	write_environment_file,
	isolate_project,
	isolate_subdirectory,
	restore_project,
	import_config,
	load_web_server,
}

export type { WebServer }
export { CI_KEY, playwright_config_fixture, SEED_KEY }
