import { afterEach, describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawnSync: spawn_mock }))
vi.mock('node:fs', () => ({
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue('{"version":"0.0.0"}'),
}))

const { josh_logic, resolve_tsx_executable } = await import('./josh-logic')

const ORIGINAL_PLATFORM = process.platform
const SPAWN_SUCCESS = { error: undefined, status: 0, signal: undefined }

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

describe('josh_logic.spawn_script shell option', () => {
	it('passes shell: true to spawnSync on win32', () => {
		spawn_mock.mockReturnValue(SPAWN_SUCCESS)
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

		josh_logic.spawn_script('tsx.cmd', ['script.ts'])

		expect(spawn_mock).toHaveBeenCalledWith(
			'tsx.cmd',
			['script.ts'],
			expect.objectContaining({ shell: true }),
		)
	})

	it('passes shell: false to spawnSync on darwin', () => {
		spawn_mock.mockReturnValue(SPAWN_SUCCESS)
		Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

		josh_logic.spawn_script('tsx', ['script.ts'])

		expect(spawn_mock).toHaveBeenCalledWith(
			'tsx',
			['script.ts'],
			expect.objectContaining({ shell: false }),
		)
	})
})
