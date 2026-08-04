import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve_spawn_exit, SIGNAL_KILL_EXIT_CODE, SPAWN_ERROR_EXIT_CODE } from './spawn-exit'

const EXECUTABLE = 'secretlint'
const SPAWN_ERROR_MESSAGE = 'ENOENT: no such file or directory'
const FINDING_EXIT_CODE = 1
const CLI_ERROR_EXIT_CODE = 2

afterEach(() => {
	vi.restoreAllMocks()
})

describe('resolve_spawn_exit', () => {
	it('returns a zero exit code verbatim', () => {
		expect(resolve_spawn_exit(EXECUTABLE, { exitCode: 0 })).toBe(0)
	})

	// A non-zero code means the tool ran and reported — forwarding it verbatim is what
	// keeps a wrapper transparent to its caller (a detected secret must still block).
	it('returns a non-zero exit code verbatim', () => {
		expect(resolve_spawn_exit(EXECUTABLE, { exitCode: FINDING_EXIT_CODE })).toBe(FINDING_EXIT_CODE)
		expect(resolve_spawn_exit(EXECUTABLE, { exitCode: CLI_ERROR_EXIT_CODE })).toBe(
			CLI_ERROR_EXIT_CODE,
		)
	})

	// execa reports a spawn failure as `exitCode: undefined` plus a `shortMessage`.
	it('reports a spawn failure with the dedicated exit code', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		const code = resolve_spawn_exit(EXECUTABLE, {
			exitCode: undefined,
			shortMessage: SPAWN_ERROR_MESSAGE,
		})

		expect(code).toBe(SPAWN_ERROR_EXIT_CODE)
	})

	it('names the executable and the reason when spawning fails', () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		resolve_spawn_exit(EXECUTABLE, { exitCode: undefined, shortMessage: SPAWN_ERROR_MESSAGE })

		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining(EXECUTABLE))
		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining(SPAWN_ERROR_MESSAGE))
	})

	// A signal kill also has no exitCode, but is flagged via `isTerminated` — it is not a
	// spawn failure, so it must not be reported as one.
	it('falls back to 1 without logging when killed by a signal', () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		const code = resolve_spawn_exit(EXECUTABLE, { exitCode: undefined, isTerminated: true })

		expect(code).toBe(SIGNAL_KILL_EXIT_CODE)
		expect(error_spy).not.toHaveBeenCalled()
	})
})
