import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { find_local_bin_upwards, resolve_local_bin } from './local-bin'

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
}))

const mocked_exists = vi.mocked(existsSync)

const ORIGINAL_PLATFORM = process.platform
const PROJECT_ROOT = path.join(path.sep, 'repo')
const BIN_NAME = 'cspell'
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
			path.join(PROJECT_ROOT, 'node_modules', '.bin', BIN_NAME),
		)
	})

	// Only the `.cmd` shim is executable on Windows; spawning the extensionless one fails with
	// EACCES, which is why every call site needs the suffix rather than the bare name.
	it('selects the .cmd shim on win32', () => {
		set_platform('win32')

		expect(resolve_local_bin(PROJECT_ROOT, BIN_NAME)).toBe(
			path.join(PROJECT_ROOT, 'node_modules', '.bin', `${BIN_NAME}.cmd`),
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
