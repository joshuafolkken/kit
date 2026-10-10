import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_cli_fault } from './run-cli-fault'

const WHERE = 'run:cut'
const DIRECTORY = '/repository/.git'
const REASON = 'not a git repository'
const DEBUG_ENV_KEY = 'JOSH_DEBUG'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('resolving the git directory', () => {
	it.each([[DIRECTORY], [undefined]])('passes %s through as resolved', async (directory) => {
		const read = vi.fn().mockResolvedValue(directory)

		expect(await run_cli_fault.directory_of(WHERE, read)).toBe(directory)
	})

	it('folds a resolution that throws into undefined', async () => {
		const read = vi.fn().mockRejectedValue(new Error(REASON))

		expect(await run_cli_fault.directory_of(WHERE, read)).toBeUndefined()
	})

	it('keeps the reason git gave under JOSH_DEBUG', async () => {
		vi.stubEnv(DEBUG_ENV_KEY, '1')
		const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await run_cli_fault.directory_of(WHERE, vi.fn().mockRejectedValue(new Error(REASON)))

		expect(write.mock.calls).toStrictEqual([[`josh debug: ${WHERE}: ${REASON}\n`]])
	})
})

describe('reporting a failure nobody planned', () => {
	it.each([
		['an Error', new TypeError(REASON)],
		['a thrown string', REASON],
	])('names the command and carries the message of %s', (_name, error) => {
		expect(run_cli_fault.message(WHERE, error)).toBe(
			`${WHERE} failed and established nothing: ${REASON}`,
		)
	})
})
