import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same import-time paths as the other `init` integration tests, so the same getter mock
// (joshuafolkken/kit#879).
const paths_mock = vi.hoisted(() => ({ root: '', package_dir: '' }))

vi.mock('./init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	get PACKAGE_DIR(): string {
		return paths_mock.package_dir
	},
	package_path: (relative_path: string): string => path.join(paths_mock.package_dir, relative_path),
}))
vi.mock('execa', () => ({ execaSync: vi.fn() }))

// Every git read answers successfully and empty: a repository whose checkout does not record kit.
function empty_git_result(): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: 0, stdout: '' }

	return value as ReturnType<typeof execaSync>
}

beforeEach(() => {
	vi.resetModules()
	paths_mock.package_dir = fileURLToPath(new URL('../../', import.meta.url))
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'josh-init-start-hint-'))
	writeFileSync(path.join(paths_mock.root, 'index.html'), '<h1>Hello</h1>')
	mkdirSync(path.join(paths_mock.root, '.git'))
	vi.mocked(execaSync).mockReturnValue(empty_git_result())
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// A person who chose `josh init` chose against the Issue workflow, and its output left uncommitted is
// exactly what `josh start` refuses to run over, so nothing points onward to it (#3835).
describe('what josh init ends with (#3835)', () => {
	it('never points at josh start, even in a repository that does not record kit', async () => {
		const { run_cli } = await import('./init')

		run_cli(['--no-install'])

		expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('josh start'))
	})
})
