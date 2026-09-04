import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue('{"version":"0.0.0"}'),
}))

const { josh_logic, SPAWN_ERROR_EXIT_CODE, USAGE_ERROR_EXIT_CODE } = await import('./josh-logic')

const SPAWN_ERROR_MESSAGE = 'ENOENT: no such file or directory'
const SCRIPT_ARGS = ['scripts/josh/josh.ts']
const SHELL_CMD = ['/bin/sh', '-c', 'echo hello']
// execa reports a spawn failure as `exitCode: undefined` plus a `shortMessage`.
const SPAWN_FAILURE = { exitCode: undefined, shortMessage: SPAWN_ERROR_MESSAGE }
// A signal kill also has no exitCode, but is flagged via `isTerminated`.
const SIGNAL_KILL = { exitCode: undefined, isTerminated: true }
const SPAWN_SUCCESS = { exitCode: 0 }

describe('josh_logic.spawn_script — spawn error', () => {
	it('returns SPAWN_ERROR_EXIT_CODE when exitCode is undefined', () => {
		execa_sync_mock.mockReturnValue(SPAWN_FAILURE)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		const code = josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(code).toBe(SPAWN_ERROR_EXIT_CODE)
		vi.restoreAllMocks()
	})

	it('logs the error message when spawn fails', () => {
		execa_sync_mock.mockReturnValue(SPAWN_FAILURE)
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining(SPAWN_ERROR_MESSAGE))
		vi.restoreAllMocks()
	})

	it('returns actual status code when spawn succeeds', () => {
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)

		const code = josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(code).toBe(0)
	})

	it('returns 1 without logging a spawn error when killed by a signal', () => {
		execa_sync_mock.mockReturnValue(SIGNAL_KILL)
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		const code = josh_logic.spawn_script('tsx', SCRIPT_ARGS)

		expect(code).toBe(1)
		expect(error_spy).not.toHaveBeenCalled()
		vi.restoreAllMocks()
	})
})

const WORKERS_FLAG = '--workers=1'
const TEST_CMD = 'test'

describe('josh_logic.run_command — composite commands reject extra arguments', () => {
	beforeEach(() => {
		execa_sync_mock.mockClear()
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('refuses to run josh test when a flag was appended', async () => {
		await expect(josh_logic.run_command(TEST_CMD, [WORKERS_FLAG])).resolves.toBe(
			USAGE_ERROR_EXIT_CODE,
		)
	})

	// The whole point is that the flag never silently reaches a run: nothing may be spawned.
	it('spawns nothing when the arguments are refused', async () => {
		await josh_logic.run_command(TEST_CMD, [WORKERS_FLAG])

		expect(execa_sync_mock).not.toHaveBeenCalled()
	})

	it('prints where the arguments belong', async () => {
		await josh_logic.run_command(TEST_CMD, [WORKERS_FLAG])

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining('josh test:unit'))
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.stringContaining('josh test:e2e'))
	})

	it('still runs josh test unchanged when no arguments were appended', async () => {
		await expect(josh_logic.run_command(TEST_CMD, [])).resolves.toBe(0)
		expect(execa_sync_mock).toHaveBeenCalledOnce()
	})

	// `t` is the alias for `test`; the guard resolves it first, so the alias cannot slip past.
	it('applies the refusal to the aliased form as well', async () => {
		await expect(josh_logic.run_command('t', [WORKERS_FLAG])).resolves.toBe(USAGE_ERROR_EXIT_CODE)
		expect(execa_sync_mock).not.toHaveBeenCalled()
	})
})

describe('josh_logic.run_shell_command — spawn error', () => {
	it('returns SPAWN_ERROR_EXIT_CODE when executable fails to start', () => {
		execa_sync_mock.mockReturnValue(SPAWN_FAILURE)
		vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		const code = josh_logic.run_shell_command(SHELL_CMD, [])

		expect(code).toBe(SPAWN_ERROR_EXIT_CODE)
		vi.restoreAllMocks()
	})

	it('returns actual status code when command succeeds', () => {
		execa_sync_mock.mockReturnValue(SPAWN_SUCCESS)

		const code = josh_logic.run_shell_command(SHELL_CMD, [])

		expect(code).toBe(0)
	})
})
