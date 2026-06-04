import { describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawnSync: spawn_mock }))
vi.mock('node:fs', () => ({
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue('{"version":"0.0.0"}'),
}))

const { josh_logic, SPAWN_ERROR_EXIT_CODE } = await import('./josh-logic')

const SPAWN_ERROR = new Error('ENOENT: no such file or directory')
const SCRIPT_ARGS = ['scripts/josh/josh.ts']
const SHELL_CMD = ['/bin/sh', '-c', 'echo hello']
const SPAWN_FAILURE = { error: SPAWN_ERROR, status: undefined, signal: undefined }
const SPAWN_SUCCESS = { error: undefined, status: 0, signal: undefined }

describe('josh_logic.spawn_script — spawn error', () => {
	it('returns SPAWN_ERROR_EXIT_CODE when result.error is set', () => {
		spawn_mock.mockReturnValue(SPAWN_FAILURE)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		const code = josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(code).toBe(SPAWN_ERROR_EXIT_CODE)
		vi.restoreAllMocks()
	})

	it('logs the error message when spawn fails', () => {
		spawn_mock.mockReturnValue(SPAWN_FAILURE)
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining(SPAWN_ERROR.message))
		vi.restoreAllMocks()
	})

	it('returns actual status code when spawn succeeds', () => {
		spawn_mock.mockReturnValue(SPAWN_SUCCESS)

		const code = josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(code).toBe(0)
	})
})

describe('josh_logic.run_shell_command — spawn error', () => {
	it('returns SPAWN_ERROR_EXIT_CODE when executable fails to start', () => {
		spawn_mock.mockReturnValue(SPAWN_FAILURE)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		const code = josh_logic.run_shell_command(SHELL_CMD, [])

		expect(code).toBe(SPAWN_ERROR_EXIT_CODE)
		vi.restoreAllMocks()
	})

	it('returns actual status code when command succeeds', () => {
		spawn_mock.mockReturnValue(SPAWN_SUCCESS)

		const code = josh_logic.run_shell_command(SHELL_CMD, [])

		expect(code).toBe(0)
	})
})
