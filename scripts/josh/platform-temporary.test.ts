import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PLATFORM_TEMP_ROOT, platform_temporary, POSIX_TEMP_ROOT } from './platform-temporary'

// joshuafolkken/kit#1909: a record one process writes for another to read must key on a root neither
// end's `TMPDIR` can move. On POSIX that root is `/tmp`; on Windows `os.tmpdir()` is left as it was,
// and a POSIX host that cannot write `/tmp` keeps the `os.tmpdir()` it had.
const LINUX_PLATFORM = 'linux'
const WINDOWS_PLATFORM = 'win32'

function always_writable(): boolean {
	return true
}

function never_writable(): boolean {
	return false
}

describe('platform_temporary.resolve_temporary_root', () => {
	it('pins a POSIX host to /tmp when it can be written', () => {
		expect(platform_temporary.resolve_temporary_root(LINUX_PLATFORM, always_writable)).toBe(
			POSIX_TEMP_ROOT,
		)
	})

	it('falls back to os.tmpdir() on a POSIX host whose /tmp cannot be written', () => {
		expect(platform_temporary.resolve_temporary_root(LINUX_PLATFORM, never_writable)).toBe(tmpdir())
	})

	it('leaves Windows on os.tmpdir() whatever /tmp would answer', () => {
		expect(platform_temporary.resolve_temporary_root(WINDOWS_PLATFORM, always_writable)).toBe(
			tmpdir(),
		)
	})
})

describe('PLATFORM_TEMP_ROOT', () => {
	it('is the root this host resolves', () => {
		expect(PLATFORM_TEMP_ROOT).toBe(platform_temporary.resolve_temporary_root(process.platform))
	})
})
