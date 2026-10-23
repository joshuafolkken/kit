import { constants } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
// `constants` stays real: the lane ledger reads its open flags at import.
vi.mock('node:fs', () => ({
	constants,
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue('{"version":"0.0.0"}'),
}))

const { josh_logic, resolve_tsx_executable } = await import('./josh-logic')

const ORIGINAL_PLATFORM = process.platform
const SPAWN_SUCCESS = { exitCode: 0 }
const SCRIPT_FILE_ARGS = ['script.ts']

afterEach(() => {
	Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
	vi.restoreAllMocks()
})

describe('resolve_tsx_executable on win32', () => {
	it('returns tsx.cmd path when tsx.cmd exists in node_modules', async () => {
		const fs_module = await import('node:fs')

		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
		vi.mocked(fs_module.existsSync).mockImplementation((file_path) =>
			String(file_path).endsWith('tsx.cmd'),
		)

		expect(resolve_tsx_executable()).toMatch(/tsx\.cmd$/u)
	})

	it('falls back to tsx when tsx.cmd is not found', async () => {
		const fs_module = await import('node:fs')

		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
		vi.mocked(fs_module.existsSync).mockReturnValue(false)

		expect(resolve_tsx_executable()).toBe('tsx')
	})
})

describe('resolve_tsx_executable on non-win32', () => {
	it('returns tsx path without .cmd extension on darwin', async () => {
		const fs_module = await import('node:fs')

		Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
		vi.mocked(fs_module.existsSync).mockImplementation(
			(file_path) => !String(file_path).endsWith('.cmd'),
		)

		expect(resolve_tsx_executable()).not.toMatch(/\.cmd$/u)
	})
})

// The shell would hand the arguments to cmd.exe unescaped; execa runs a `.cmd` shim itself and
// escapes them, so no platform or executable turns the shell on.
describe('josh_logic.spawn_script shell option', () => {
	it.each([
		['win32', 'tsx.cmd'],
		['win32', process.execPath],
		['darwin', 'tsx'],
	])('never passes a shell to execaSync on %s spawning %s', (platform, executable) => {
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)
		Object.defineProperty(process, 'platform', { value: platform, configurable: true })

		josh_logic.spawn_script(executable, SCRIPT_FILE_ARGS)

		expect(execa_sync_mock).toHaveBeenCalledWith(
			executable,
			SCRIPT_FILE_ARGS,
			expect.not.objectContaining({ shell: true }),
		)
	})
})
