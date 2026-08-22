import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { environment_file_fixture } from './environment-file-fixture'
import { PORT_SEED_KEY, ports, type PortEnvironment } from './index.js'

const DEFAULT_DEV_PORT = 5173
const DEFAULT_PREVIEW_PORT = 4173
const SEED = 1
// Stated independently of the module's own arithmetic: the highest seed that still keeps the dev
// port — the higher of the two bases — inside the 65535 the protocol allows.
const MAX_SEED = 60_362
const ABOVE_MAX_SEED = String(MAX_SEED + 1)

// A silent fallback to 0 would put two projects back on one port, which is the failure the seed
// exists to remove, so every malformed shape has to raise instead of defaulting.
const REJECTED_SEEDS: ReadonlyArray<string> = ['abc', '-1', '1.5', '1e3', '+1']

// #820: `.env.example` ships `PORT_SEED=` with no value, so a blank one is how a developer says "I
// have not set this" — both by copying the sample and by clearing a seed they no longer want. It
// used to raise, which turned copying the sample into an error from `josh port` and, once
// `playwright.config.ts` started reading `.env`, would have cost that developer the whole E2E suite.
const BLANK_SEEDS: ReadonlyArray<string> = ['', ' ', '\t']

const TEMP_DIRECTORY_PREFIX = 'kit-ports-'
const FILE_SEED = 3
const FILE_SEED_TEXT = String(FILE_SEED)
const SHELL_SEED = '9'

// #826: a consumer's `.env` is where the tokens live. `.env.example` in joshuafolkken-com ships
// seven of them, and the one that bites is `CLOUDFLARE_API_TOKEN` — `wrangler` prefers it over the
// OAuth session, so a token short of the needed scopes turns the preview server into a 403.
const SECRET_KEY = 'CLOUDFLARE_API_TOKEN'
const REUSE_KEY = 'PLAYWRIGHT_REUSE_SERVER'
const CI_KEY = 'CI'
const SECRET_VALUE = 'token-from-env-file'
const NESTED_DIRECTORY_NAME = 'e2e'
const NESTED_SEED = '5'

function environment(seed: string | undefined): PortEnvironment {
	return { [PORT_SEED_KEY]: seed }
}

describe('ports.resolve_seed', () => {
	// The variable name is the whole public interface a developer types into `.env`, so renaming it
	// silently would leave every documented example pointing at a variable nothing reads.
	it('reads PORT_SEED', () => {
		expect(PORT_SEED_KEY).toBe('PORT_SEED')
	})

	it('is 0 when PORT_SEED is unset, so CI and un-migrated consumers are unaffected', () => {
		expect(ports.resolve_seed({})).toBe(0)
	})

	it.each(BLANK_SEEDS)('reads a blank %j as unset rather than as a mistake', (seed) => {
		expect(ports.resolve_seed(environment(seed))).toBe(0)
	})

	it('reads an integer seed', () => {
		expect(ports.resolve_seed(environment('7'))).toBe(7)
	})

	it('accepts the highest seed that keeps both ports below the protocol maximum', () => {
		const highest = environment(String(MAX_SEED))

		expect(ports.resolve_seed(highest)).toBe(MAX_SEED)
	})

	it.each([...REJECTED_SEEDS, ABOVE_MAX_SEED])(
		'rejects %j instead of falling back to the default',
		(seed) => {
			expect(() => ports.resolve_seed(environment(seed))).toThrow(PORT_SEED_KEY)
		},
	)

	it('names the default ports in the error so the fix is visible without reading the docs', () => {
		expect(() => ports.resolve_seed(environment('abc'))).toThrow(String(DEFAULT_DEV_PORT))
	})
})

describe('ports.resolve_development_port / ports.resolve_preview_port', () => {
	it('keeps todays ports when PORT_SEED is unset', () => {
		expect(ports.resolve_development_port({})).toBe(DEFAULT_DEV_PORT)
		expect(ports.resolve_preview_port({})).toBe(DEFAULT_PREVIEW_PORT)
	})

	it('moves both ports by the same seed', () => {
		const seeded = environment(String(SEED))

		expect(ports.resolve_development_port(seeded)).toBe(DEFAULT_DEV_PORT + SEED)
		expect(ports.resolve_preview_port(seeded)).toBe(DEFAULT_PREVIEW_PORT + SEED)
	})

	it('gives two seeds two distinct port pairs, so both previews can run at once', () => {
		const first = ports.resolve_preview_port(environment('1'))
		const second = ports.resolve_preview_port(environment('2'))

		expect(first).not.toBe(second)
	})

	it('propagates an invalid seed rather than serving a default port', () => {
		expect(() => ports.resolve_development_port(environment('abc'))).toThrow(PORT_SEED_KEY)
		expect(() => ports.resolve_preview_port(environment('abc'))).toThrow(PORT_SEED_KEY)
	})
})

// #820: `josh port` reads `.env` through tsx's `--env-file-if-exists=.env`, but Playwright loads
// `playwright.config.ts` with no such flag anywhere on the path, so the same file produced two
// different ports. This is the one loader both sides now share.
// Created once as this file loads so no hook has to assign it, and removed again in `afterAll` —
// `mkdtempSync` leaves the directory behind otherwise.
const PROJECT_DIRECTORY = environment_file_fixture.make_project_directory(TEMP_DIRECTORY_PREFIX)

function load_seed_from(contents?: string): boolean {
	vi.stubEnv(PORT_SEED_KEY, undefined)

	if (contents !== undefined) {
		environment_file_fixture.write_environment_file(PROJECT_DIRECTORY, contents)
	}

	return ports.load_environment_file(PROJECT_DIRECTORY)
}

afterEach(() => {
	environment_file_fixture.clear_environment_file(PROJECT_DIRECTORY)
	vi.unstubAllEnvs()
})

afterAll(() => {
	environment_file_fixture.remove_project_directory(PROJECT_DIRECTORY)
})

describe('ports.load_environment_file', () => {
	it('puts the seed written in .env where every reader of process.env finds it', () => {
		expect(load_seed_from(`${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n`)).toBe(true)
		expect(ports.resolve_development_port()).toBe(DEFAULT_DEV_PORT + FILE_SEED)
		expect(ports.resolve_preview_port()).toBe(DEFAULT_PREVIEW_PORT + FILE_SEED)
	})

	// A project with no `.env` is the CI case and the un-migrated consumer, so the loader has to be
	// a no-op there rather than the hard failure `--env-file` (without `-if-exists`) would raise.
	it('leaves a project with no .env on the default ports', () => {
		expect(load_seed_from()).toBe(false)
		expect(ports.resolve_development_port()).toBe(DEFAULT_DEV_PORT)
	})

	it('reads a blank seed from .env as unset, the shape .env.example ships', () => {
		load_seed_from(`${PORT_SEED_KEY}=\n`)

		expect(ports.resolve_development_port()).toBe(DEFAULT_DEV_PORT)
	})

	// Same precedence as the tsx flag it stands in for, so `PORT_SEED=9 pnpm josh test:e2e` still
	// overrides the file for a one-off run.
	it('lets a variable already set in the environment win over the file', () => {
		load_seed_from(`${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n`)
		vi.stubEnv(PORT_SEED_KEY, SHELL_SEED)

		ports.load_environment_file(PROJECT_DIRECTORY)

		expect(process.env[PORT_SEED_KEY]).toBe(SHELL_SEED)
	})
})

// #826: `playwright.config.ts` reads one variable, but the `webServer` child inherits this whole
// process, so every other key the file carried used to reach the dev or preview server too. These
// two suites are the boundary: the seed crosses, nothing else does, and the file is found from a
// subdirectory the way `pnpm run` finds it.
describe('ports.load_environment_file — what crosses from .env', () => {
	it('keeps the seed the file sets', () => {
		load_seed_from(`${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n${SECRET_KEY}=${SECRET_VALUE}\n`)

		expect(process.env[PORT_SEED_KEY]).toBe(FILE_SEED_TEXT)
	})

	it('leaves every other variable in the file out of the environment', () => {
		// Cleared first: a developer who exports this token would otherwise see their own value here
		// and the assertion would pass or fail by machine rather than by behavior.
		vi.stubEnv(SECRET_KEY, undefined)
		load_seed_from(`${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n${SECRET_KEY}=${SECRET_VALUE}\n`)

		expect(process.env[SECRET_KEY]).toBeUndefined()
	})

	// Finding from #826's review: the config reads `PLAYWRIGHT_REUSE_SERVER` too, so stripping every
	// key but the seed silently turned reuse off for anyone who had set it in `.env` — and Playwright
	// then aborts on the busy port instead of adopting the server that is already there.
	it('keeps the reuse flag the Playwright config reads', () => {
		vi.stubEnv(REUSE_KEY, undefined)
		load_seed_from(`${REUSE_KEY}=1\n`)

		expect(process.env[REUSE_KEY]).toBe('1')
	})

	// `CI` describes the run, not the project. Honouring it from a file would put every local run
	// into CI mode for as long as the line stayed there.
	it('leaves CI out even though the same config reads it', () => {
		vi.stubEnv(CI_KEY, undefined)
		load_seed_from(`${CI_KEY}=1\n`)

		expect(process.env[CI_KEY]).toBeUndefined()
	})

	// The restore may not reach past what the file introduced: a variable the run already had is
	// the caller's, and deleting it would break whatever set it.
	it('leaves a variable the environment already carried untouched', () => {
		vi.stubEnv(SECRET_KEY, SHELL_SEED)
		load_seed_from(`${SECRET_KEY}=${SECRET_VALUE}\n`)

		expect(process.env[SECRET_KEY]).toBe(SHELL_SEED)
	})
})

describe('ports.load_environment_file — .env from a subdirectory', () => {
	// Its own project each time: these tests build a root and a directory under it, and none of
	// that may outlive the test that made it.
	let marked_project = ''

	beforeEach(() => {
		vi.stubEnv(PORT_SEED_KEY, undefined)
		marked_project = environment_file_fixture.make_project_directory(TEMP_DIRECTORY_PREFIX)
		environment_file_fixture.write_environment_file(
			marked_project,
			`${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n`,
		)
	})

	afterEach(() => {
		environment_file_fixture.remove_project_directory(marked_project)
	})

	it('reads the project root .env from a subdirectory under it', () => {
		const nested = environment_file_fixture.make_subdirectory(marked_project, NESTED_DIRECTORY_NAME)

		expect(ports.load_environment_file(nested)).toBe(true)
		expect(ports.resolve_development_port()).toBe(DEFAULT_DEV_PORT + FILE_SEED)
	})

	// A `.env` beside the caller must not win. An `e2e/.env` holding unrelated fixture data and no
	// seed would otherwise shadow the root's, putting this side back on seed 0 while `pnpm run dev`
	// at the root still reads the seeded one — the #826 timeout, re-created by the fix for it.
	it('prefers the project root .env over one sitting beside the caller', () => {
		const nested = environment_file_fixture.make_subdirectory(marked_project, NESTED_DIRECTORY_NAME)

		environment_file_fixture.write_environment_file(nested, `${PORT_SEED_KEY}=${NESTED_SEED}\n`)

		expect(ports.load_environment_file(nested)).toBe(true)
		expect(ports.resolve_development_port()).toBe(DEFAULT_DEV_PORT + FILE_SEED)
	})
})

describe('ports.load_environment_file — where the search stops', () => {
	let outer = ''
	let marked = ''

	beforeEach(() => {
		vi.stubEnv(PORT_SEED_KEY, undefined)
		outer = environment_file_fixture.make_unmarked_directory(TEMP_DIRECTORY_PREFIX)
		marked = environment_file_fixture.make_project_directory(TEMP_DIRECTORY_PREFIX)
	})

	// Both directories and the `process.cwd` spy come back here rather than at the end of a test
	// body: a failing assertion would otherwise leave the mock in place for every test after it.
	afterEach(() => {
		vi.restoreAllMocks()
		environment_file_fixture.remove_project_directory(outer)
		environment_file_fixture.remove_project_directory(marked)
	})

	// `path.dirname('.')` is `'.'`, so a relative directory used to end the ascent on its first step
	// and read nothing — the #826 mismatch again, for any caller that passes one.
	it('ascends from a relative directory the same way', () => {
		environment_file_fixture.write_environment_file(marked, `${PORT_SEED_KEY}=${FILE_SEED_TEXT}\n`)
		environment_file_fixture.make_subdirectory(marked, NESTED_DIRECTORY_NAME)
		vi.spyOn(process, 'cwd').mockReturnValue(path.join(marked, NESTED_DIRECTORY_NAME))

		expect(ports.load_environment_file('.')).toBe(true)
		expect(ports.resolve_development_port()).toBe(DEFAULT_DEV_PORT + FILE_SEED)
	})

	// The search stops at the root rather than climbing on, so a `.env` in the directory that
	// happens to hold the project — `$TMPDIR`, or a home directory — is never adopted.

	it('does not climb past the project root to a .env above it', () => {
		environment_file_fixture.write_environment_file(outer, `${PORT_SEED_KEY}=${NESTED_SEED}\n`)
		const inner = environment_file_fixture.make_subdirectory(outer, NESTED_DIRECTORY_NAME)

		environment_file_fixture.write_package_file(inner)

		expect(ports.load_environment_file(inner)).toBe(false)
	})
})
