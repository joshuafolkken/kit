import { CSPELL_CACHE_FILE, CSPELL_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import { buffered_process } from '#scripts/lib/buffered-process'
import { beforeEach, expect, test, vi } from 'vitest'
import { CSPELL_ARGS, cspell_cached } from './cspell-cached'

const PASS = 0
const FAIL = 1
const OUTPUT = 'Unknown word'

vi.mock('#scripts/lane/lane-cache-run', () => ({
	lane_cache_run: {
		run: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => await work()),
	},
}))
vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		is_process_failed: vi.fn(() => false),
		run_buffered_process: vi.fn(async () => ({ output: '', exit_code: PASS, elapsed_ms: 1 })),
	},
	FAIL_EXIT_CODE: 1,
}))

const run_cache = vi.mocked(lane_cache_run.run)
const run_process = vi.mocked(buffered_process.run_buffered_process)
const is_process_failed = vi.mocked(buffered_process.is_process_failed)

beforeEach(() => {
	vi.clearAllMocks()
})

test('runs cspell through its shared cache immediately around the process', async () => {
	await cspell_cached.run()

	expect(run_cache).toHaveBeenCalledWith(CSPELL_CACHE_FILE, expect.any(Function))
	expect(run_process).toHaveBeenCalledWith(CSPELL_ARGS)
})

test('keeps the cspell cache flags on the subprocess', () => {
	expect(CSPELL_ARGS.join(' ')).toContain(CSPELL_CACHE_FLAGS.join(' '))
})

// joshuafolkken/kit#2296: the per-file progress line is what filled the tool's 8,000-character cap
// ahead of the actual failures, so it is turned off by default.
test('turns off cspell progress lines', () => {
	expect(CSPELL_ARGS).toContain('--no-progress')
})

test('forwards additional command arguments to cspell', async () => {
	await cspell_cached.run(['--verbose'])

	expect(run_process).toHaveBeenCalledWith([...CSPELL_ARGS, '--verbose'])
})

test('preserves a cspell failure and its output', async () => {
	run_process.mockResolvedValue({ output: OUTPUT, exit_code: FAIL, elapsed_ms: 1 })
	is_process_failed.mockReturnValue(true)
	const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

	await expect(cspell_cached.run()).resolves.toBe(FAIL)
	expect(stdout).toHaveBeenCalledWith(OUTPUT)
})
