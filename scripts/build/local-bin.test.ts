import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { find_local_bin_upwards, resolve_local_bin, resolve_package_bin } from './local-bin'

const resolve_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}))

vi.mock('node:module', () => ({ createRequire: () => ({ resolve: resolve_mock }) }))

const mocked_exists = vi.mocked(existsSync)
const mocked_read = vi.mocked(readFileSync)

const ORIGINAL_PLATFORM = process.platform
const PROJECT_ROOT = path.join(path.sep, 'repo')
const BIN_NAME = 'cspell'
const NODE_MODULES = 'node_modules'
const NESTED = path.join(PROJECT_ROOT, 'src', 'lib')

function set_platform(platform: string): void {
	Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
	set_platform(ORIGINAL_PLATFORM)
})

describe('resolve_local_bin', () => {
	it('points at the pnpm shim directory of the given project root', () => {
		set_platform('darwin')

		expect(resolve_local_bin(PROJECT_ROOT, BIN_NAME)).toBe(
			path.join(PROJECT_ROOT, NODE_MODULES, '.bin', BIN_NAME),
		)
	})

	// Only the `.cmd` shim is executable on Windows; spawning the extensionless one fails with
	// EACCES, which is why every call site needs the suffix rather than the bare name.
	it('selects the .cmd shim on win32', () => {
		set_platform('win32')

		expect(resolve_local_bin(PROJECT_ROOT, BIN_NAME)).toBe(
			path.join(PROJECT_ROOT, NODE_MODULES, '.bin', `${BIN_NAME}.cmd`),
		)
	})
})

describe('find_local_bin_upwards', () => {
	beforeEach(() => {
		set_platform('darwin')
		vi.clearAllMocks()
	})

	it('finds the shim in the directory it starts from', () => {
		const shim = resolve_local_bin(PROJECT_ROOT, BIN_NAME)

		mocked_exists.mockImplementation((candidate: unknown) => String(candidate) === shim)

		expect(find_local_bin_upwards(PROJECT_ROOT, BIN_NAME)).toBe(shim)
	})

	// pnpm walks up to find a shim, so a command typed in a subdirectory resolves the same one.
	// A caller that only looked in its own directory would disagree with the commands it spawns.
	it('ascends until it finds the shim', () => {
		const shim = resolve_local_bin(PROJECT_ROOT, BIN_NAME)

		mocked_exists.mockImplementation((candidate: unknown) => String(candidate) === shim)

		expect(find_local_bin_upwards(NESTED, BIN_NAME)).toBe(shim)
	})

	// The walk has to stop at the filesystem root rather than looping on it.
	it('returns nothing when no ancestor holds the shim', () => {
		mocked_exists.mockReturnValue(false)

		expect(find_local_bin_upwards(NESTED, BIN_NAME)).toBeUndefined()
	})
})

const TSX = 'tsx'
const MANIFEST_PATH = path.join(PROJECT_ROOT, NODE_MODULES, TSX, 'package.json')
const CLI_ENTRY = path.join(PROJECT_ROOT, NODE_MODULES, TSX, 'dist', 'cli.mjs')
const STRING_BIN = '{"bin":"./dist/cli.mjs"}'
const RECORD_BIN = '{"bin":{"tsx":"./dist/cli.mjs"}}'

function arrange_manifest(manifest_json: string): void {
	vi.clearAllMocks()
	resolve_mock.mockReturnValue(MANIFEST_PATH)
	mocked_exists.mockReturnValue(true)
	mocked_read.mockReturnValue(manifest_json)
}

function resolve_tsx(): string | undefined {
	return resolve_package_bin(PROJECT_ROOT, TSX, TSX)
}

// The route the `.bin` shim cannot take: pnpm writes a shim only for a project's direct
// dependencies, so a CLI this kit depends on is invisible from a consumer's root, and a shim left
// behind by an earlier version points at a pruned store path (joshuafolkken/kit#668).
describe('resolve_package_bin — a resolvable package', () => {
	it.each([
		['the string form of the bin field', STRING_BIN],
		['the record form of the bin field', RECORD_BIN],
	])('resolves the CLI entry from %s', (_label, manifest_json) => {
		arrange_manifest(manifest_json)

		expect(resolve_tsx()).toBe(CLI_ENTRY)
	})

	// The string form names one executable, and its name is the package's own — so a request for a
	// different bin of the same package must not be handed it.
	it('ignores the string form when a different bin name was asked for', () => {
		arrange_manifest(STRING_BIN)

		expect(resolve_package_bin(PROJECT_ROOT, TSX, 'other')).toBeUndefined()
	})

	// npm installs `@scope/name` as a `name` shim, so the string form answers to the unscoped name.
	it('matches the string form against a scoped package name without its scope', () => {
		arrange_manifest(STRING_BIN)

		expect(resolve_package_bin(PROJECT_ROOT, `@scope/${TSX}`, TSX)).toBe(CLI_ENTRY)
	})

	it('returns nothing when the manifest declares no bin for that name', () => {
		arrange_manifest('{"bin":{"other":"./dist/cli.mjs"}}')

		expect(resolve_tsx()).toBeUndefined()
	})
})

// Every caller has a slower route to fall back to, so a miss answers rather than throwing — in the
// format hook, throwing here would surface as a failed edit.
describe('resolve_package_bin — a miss answers instead of throwing', () => {
	// Resolution can succeed while the entry itself is gone, which is the stale-shim failure seen
	// from the other direction — so the file is probed rather than trusted.
	it('returns nothing when the resolved entry is missing on disk', () => {
		arrange_manifest(STRING_BIN)
		mocked_exists.mockReturnValue(false)

		expect(resolve_tsx()).toBeUndefined()
	})

	it('returns nothing when the package cannot be resolved', () => {
		arrange_manifest(STRING_BIN)
		resolve_mock.mockImplementation(() => {
			throw new Error('Cannot find module')
		})

		expect(resolve_tsx()).toBeUndefined()
	})

	it('returns nothing when the manifest is not readable JSON', () => {
		arrange_manifest('{ not json')

		expect(resolve_tsx()).toBeUndefined()
	})
})
