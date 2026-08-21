import { port_command } from '#scripts/ports/port-command'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playwright_config_fixture, SEED_KEY, type WebServer } from './playwright-config-fixture'

const CI_ON = '1'
const DEV_PORT = 5173
const PREVIEW_PORT = 4173
const SEED = 1
const INVALID_SEED = 'abc'
const FILE_SEED = 3
const FILE_SEED_TEXT = String(FILE_SEED)
const PREVIEW_ARGUMENTS = ['preview']
const SUCCESS_EXIT_CODE = 0

async function load_seeded_web_server(
	ci: string | undefined,
	seed: string | undefined,
): Promise<WebServer> {
	vi.stubEnv(SEED_KEY, seed)

	return await playwright_config_fixture.load_web_server(ci, undefined)
}

// The seed is stubbed away by the fixture, so this reads whatever the suite wrote to `.env`.
async function load_file_seeded_web_server(ci: string | undefined): Promise<WebServer> {
	return await playwright_config_fixture.load_web_server(ci, undefined)
}

function write_seed_file(value: string): void {
	playwright_config_fixture.write_environment_file(`${SEED_KEY}=${value}\n`)
}

beforeEach(playwright_config_fixture.isolate_project)
afterEach(playwright_config_fixture.restore_project)
afterAll(playwright_config_fixture.remove_project)

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

// #820: the config's own comment promised the seed came from `.env`, but Playwright loads this
// config with none of the `--env-file-if-exists=.env` that `josh port` gets from tsx, so the file
// was never read. `josh port preview` answered 4176 while the webServer waited on 4173, and a
// consumer wiring its `preview` script through `josh port preview` exactly as the docs instruct
// lost the whole E2E suite to a webServer timeout.
describe('playwright.config PORT_SEED from .env', () => {
	it('offsets the local dev port by the seed written in .env', async () => {
		write_seed_file(FILE_SEED_TEXT)
		const web_server = await load_file_seeded_web_server(undefined)

		expect(web_server.port).toBe(DEV_PORT + FILE_SEED)
	})

	it('offsets the CI preview port by the seed written in .env', async () => {
		write_seed_file(FILE_SEED_TEXT)
		const web_server = await load_file_seeded_web_server(CI_ON)

		expect(web_server.port).toBe(PREVIEW_PORT + FILE_SEED)
	})

	it('keeps the historical ports for a project that has no .env', async () => {
		const web_server = await load_file_seeded_web_server(undefined)

		expect(web_server.port).toBe(DEV_PORT)
	})

	// `.env.example` ships the key with no value, so this is what a project gets by copying it.
	it('keeps the historical ports for the blank seed .env.example ships', async () => {
		write_seed_file('')
		const web_server = await load_file_seeded_web_server(undefined)

		expect(web_server.port).toBe(DEV_PORT)
	})

	it('fails to load rather than serving a default port for an invalid seed in .env', async () => {
		write_seed_file(INVALID_SEED)

		await expect(load_file_seeded_web_server(undefined)).rejects.toThrow(SEED_KEY)
	})

	// The agreement is the deliverable: a consumer substitutes `josh port` into its `preview`
	// script, and Playwright waits on the port this config picked. One `.env`, one number.
	it('agrees with the number josh port prints for the same .env', async () => {
		write_seed_file(FILE_SEED_TEXT)
		const web_server = await load_file_seeded_web_server(CI_ON)

		expect(web_server.port).toBe(PREVIEW_PORT + FILE_SEED)
		expect(port_command.run(PREVIEW_ARGUMENTS)).toStrictEqual({
			text: String(web_server.port),
			exit_code: SUCCESS_EXIT_CODE,
		})
	})
})
