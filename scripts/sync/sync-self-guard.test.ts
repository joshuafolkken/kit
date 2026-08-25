import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_NAME = '@joshuafolkken/kit'

// The paths are read at import time by sync.ts, so they are mocked rather than passed in: the whole
// point of the guard is what `main()` does with the paths it was born with (joshuafolkken/kit#868).
const paths_mock = vi.hoisted(() => ({ PACKAGE_DIR: '', PROJECT_ROOT: '' }))

vi.mock('#scripts/init/init-paths', () => ({
	...paths_mock,
	// `init-logic-templates` resolves a template path at import time, so the module cannot be
	// replaced by the two constants alone.
	package_path: (relative_path: string): string => path.join(paths_mock.PACKAGE_DIR, relative_path),
}))

function make_project(name: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'sync-guard-'))

	writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name }))

	return directory
}

// Both cases assert the same thing about the same run, so the run itself is shared: point the
// module at the two directories, silence the console, and hand back what `main()` reported.
async function run_guarded_sync(
	package_directory: string,
	project_root: string,
): Promise<{ written: Array<string>; message: string }> {
	paths_mock.PACKAGE_DIR = package_directory
	paths_mock.PROJECT_ROOT = project_root

	const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	vi.spyOn(console, 'info').mockImplementation(() => undefined)

	const { main } = await import('./sync')

	main()

	return { written: readdirSync(project_root), message: error_spy.mock.calls.flat().join('\n') }
}

beforeEach(() => {
	vi.resetModules()
	process.exitCode = undefined
})

afterEach(() => {
	vi.restoreAllMocks()
	process.exitCode = undefined
})

describe('sync main — inside the package’s own repository', () => {
	it('writes nothing and exits non-zero', async () => {
		const directory = make_project(PACKAGE_NAME)
		const before = readdirSync(directory)
		const { written, message } = await run_guarded_sync(directory, directory)

		expect(written).toStrictEqual(before)
		expect(process.exitCode).toBe(1)
		expect(message).toContain('Refusing to sync')
	})

	// The name match is what fires, so a global install aimed at the source repository is caught
	// even though the two directories are unrelated.
	it('refuses a global install aimed at its own repository', async () => {
		const package_directory = make_project(PACKAGE_NAME)
		const project_root = make_project(PACKAGE_NAME)
		const before = readdirSync(project_root)
		const { written, message } = await run_guarded_sync(package_directory, project_root)

		expect(written).toStrictEqual(before)
		expect(process.exitCode).toBe(1)
		// Naming the package proves the NAME branch fired: the two directories differ here, so the
		// same-directory fallback would have produced a message without it.
		expect(message).toContain(PACKAGE_NAME)
	})
})
