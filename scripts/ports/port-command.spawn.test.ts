import { environment_file_fixture } from '#ports/environment-file-fixture'
import { josh_cli_fixture } from '#scripts/josh/josh-cli-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The real command must resolve `.env` at the project root even from a subdirectory, so a consumer's
// preview script and Playwright webServer choose the same port (#820, #826).
const TEMP_DIRECTORY_PREFIX = 'kit-port-cli-'
const NESTED_DIRECTORY_NAME = 'e2e'
const DEFAULT_DEV_PORT = 5173
const FILE_SEED = 3
const FILE_SEED_TEXT = String(FILE_SEED)
const SEED_MULTIPLIER = 10
const SUCCESS_EXIT_CODE = 0
const PORT_SEED_KEY = 'PORT_SEED'

describe('josh port — where it reads .env from', () => {
	let project = ''

	beforeEach(() => {
		project = environment_file_fixture.make_project_directory(TEMP_DIRECTORY_PREFIX)
		environment_file_fixture.write_environment_file(project, `${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n`)
	})

	afterEach(() => {
		environment_file_fixture.remove_project_directory(project)
	})

	it('applies the seed in the project root .env', () => {
		const result = josh_cli_fixture.run_josh(['port', 'dev'], { cwd: project })

		expect(result.stdout).toBe(String(DEFAULT_DEV_PORT + FILE_SEED * SEED_MULTIPLIER))
		expect(result.exit_code).toBe(SUCCESS_EXIT_CODE)
	})

	it('applies the same seed when run from a subdirectory of the project', () => {
		const nested = environment_file_fixture.make_subdirectory(project, NESTED_DIRECTORY_NAME)

		const result = josh_cli_fixture.run_josh(['port', 'dev'], { cwd: nested })

		expect(result.stdout).toBe(String(DEFAULT_DEV_PORT + FILE_SEED * SEED_MULTIPLIER))
		expect(result.exit_code).toBe(SUCCESS_EXIT_CODE)
	})
})
