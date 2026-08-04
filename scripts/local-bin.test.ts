import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolve_local_bin } from './local-bin'

const ORIGINAL_PLATFORM = process.platform
const PROJECT_ROOT = path.join(path.sep, 'repo')
const BIN_NAME = 'cspell'

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
