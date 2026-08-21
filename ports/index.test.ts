import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
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
