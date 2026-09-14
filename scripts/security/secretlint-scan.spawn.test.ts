import { describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))

const { secretlint_scan } = await import('./secretlint-scan')

const BINARY = '/repo/node_modules/.bin/secretlint'
const STAGED_FILES = ['docs/my file.md', 'src/(app)/[id]/+page.svelte']
const FINDING_EXIT_CODE = 1

describe('secretlint_scan.run_scan', () => {
	// The options are matched exactly so a re-added `shell` cannot slip back in: execa resolves
	// a Windows `.cmd` shim itself and escapes the arguments for cmd.exe, and enabling the shell
	// bypasses that — `docs/my file.md` would split into two paths and the scanner would walk
	// the wrong files, then report clean.
	it('spawns the binary with the staged files behind --no-glob and no shell', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0 })

		secretlint_scan.run_scan(BINARY, STAGED_FILES)

		expect(execa_sync_mock).toHaveBeenLastCalledWith(BINARY, ['--no-glob', ...STAGED_FILES], {
			stdio: 'inherit',
			reject: false,
		})
	})

	// A detected secret must still block the commit — the wrapper is only permissive about a
	// missing binary, never about a finding.
	it('forwards a non-zero exit code from the scan', () => {
		execa_sync_mock.mockReturnValue({ exitCode: FINDING_EXIT_CODE })

		expect(secretlint_scan.run_scan(BINARY, STAGED_FILES)).toBe(FINDING_EXIT_CODE)
	})

	it('reports a spawn failure instead of silently passing', () => {
		execa_sync_mock.mockReturnValue({ exitCode: undefined, shortMessage: 'spawn ENOENT' })
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(secretlint_scan.run_scan(BINARY, STAGED_FILES)).not.toBe(0)
		vi.restoreAllMocks()
	})
})
