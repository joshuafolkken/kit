import { existsSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_DIR, PROJECT_ROOT } from '#scripts/init/init-paths'
import { describe, expect, it, vi } from 'vitest'
import { sync_directory } from './sync'

// #853 made the directory list non-empty for the first time, which turned `sync_directory` from
// dead code into a step every `josh sync` runs. Both guards below are cases it hits immediately:
// running `josh sync` inside kit copies a directory onto itself, and a directory the package does
// not carry is what a packing regression leaves behind. `cpSync` throws on either — ERR_FS_CP_EINVAL
// and ENOENT — and a throw here aborts the whole sync before the steps that follow it.
const SKILL_DIRECTORY = '.claude/skills/verify-ui'
const MISSING_DIRECTORY = path.join('does-not-exist', 'anywhere')

function capture_warning(run: () => void): ReadonlyArray<string> {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

	run()

	const messages = warn.mock.calls.map((call) => String(call[0]))

	warn.mockRestore()

	return messages
}

describe('sync_directory', () => {
	it('skips a directory the package does not carry', () => {
		const messages = capture_warning(() => {
			sync_directory(MISSING_DIRECTORY)
		})

		expect(messages.join('\n')).toContain('missing from the installed package')
		expect(existsSync(path.join(PROJECT_ROOT, MISSING_DIRECTORY))).toBe(false)
	})

	// The suite runs from the package root, so `PROJECT_ROOT` and `PACKAGE_DIR` are the same tree —
	// which is exactly the state `josh sync` runs in inside kit itself. `PROJECT_ROOT` is resolved
	// once at import, so this case cannot be simulated by mocking `process.cwd()`; it is the real one.
	it('skips a copy of the package onto itself', () => {
		expect(PROJECT_ROOT).toBe(PACKAGE_DIR)

		const messages = capture_warning(() => {
			sync_directory(SKILL_DIRECTORY)
		})

		expect(messages.join('\n')).toContain("package's own copy")
	})
})
