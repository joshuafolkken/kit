import { project_checks } from '#scripts/gate/project-checks'
import { ESLINT_CACHE_FILE } from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))
vi.mock('#scripts/lane/lane-cache-run', () => ({
	lane_cache_run: {
		run: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => await work()),
	},
}))
vi.mock('./cycle-recheck', () => ({
	cycle_recheck: { verify: vi.fn(async (result: unknown) => await result) },
}))

const { cycle_recheck } = await import('./cycle-recheck')
const mocked_verify = vi.mocked(cycle_recheck.verify)
const { lint_parallel } = await import('./lint-parallel')
const { run_lint_checks, run_lint_parallel_checks } = lint_parallel
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const mocked_cache_run = vi.mocked(lane_cache_run.run)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

// execa's resolved Result is a large interface; the lint check only reads
// `all` and `exitCode`, so a minimal stub is bridged through `unknown`.
function fake_result(exit_code: number): ExecaResult {
	const result = { all: '', exitCode: exit_code }

	return result as unknown as ExecaResult
}

function mock_exit_codes(prettier_code: number, eslint_code: number): void {
	mocked_execa
		.mockResolvedValueOnce(fake_result(prettier_code))
		.mockResolvedValueOnce(fake_result(eslint_code))
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

const WHOLE_TREE = '.'

describe('run_lint_parallel_checks', () => {
	// joshuafolkken/kit#1298 made the runner take its targets, so the whole-tree call is what keeps
	// `josh lint` and the gate reading everything rather than one change's files.
	it('points both linters at the whole tree', async () => {
		mock_exit_codes(0, 0)

		await run_lint_parallel_checks()

		expect(mocked_execa.mock.calls[0]?.[1]).toContain(WHOLE_TREE)
		expect(mocked_execa.mock.calls[1]?.[1]).toContain(WHOLE_TREE)
	})

	it('returns 0 when both prettier and eslint pass', async () => {
		mock_exit_codes(0, 0)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(0)
	})

	it('shares the eslint cache around the eslint process', async () => {
		mock_exit_codes(0, 0)

		await run_lint_parallel_checks()

		expect(mocked_cache_run).toHaveBeenCalledWith(ESLINT_CACHE_FILE, expect.any(Function))
	})

	it.each([
		['prettier fails', 1, 0],
		['eslint fails', 0, 1],
		['both fail', 1, 1],
	])('returns 1 when %s', async (_label, prettier_code, eslint_code) => {
		mock_exit_codes(prettier_code, eslint_code)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})
})

// joshuafolkken/kit#3641: the verdict the run exits on is the re-read one, so a cached cycle report
// the re-reading withdrew does not fail the lint.
describe('run_lint_parallel_checks — the cycle recheck', () => {
	it('exits on the eslint report the recheck returns', async () => {
		mock_exit_codes(0, 1)
		mocked_verify.mockResolvedValueOnce({ output: '', exit_code: 0, elapsed_ms: 0 })

		const code = await run_lint_parallel_checks()

		expect(mocked_verify).toHaveBeenCalledWith(expect.objectContaining({ exit_code: 1 }), {
			cache_file: ESLINT_CACHE_FILE,
			patterns: [WHOLE_TREE],
		})
		expect(code).toBe(0)
	})
})

describe('run_lint_checks', () => {
	const TARGET = 'scripts/thing.ts'
	const RECHECK = { cache_file: '.eslintcache.related', patterns: [TARGET] }

	it('runs the targets it was given instead of the whole tree', async () => {
		const prettier_args = ['exec', 'prettier', '--check', TARGET]
		const eslint_args = ['exec', 'eslint', TARGET]

		mock_exit_codes(0, 0)

		await run_lint_checks(prettier_args, eslint_args, RECHECK)

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual(prettier_args)
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual(eslint_args)
	})

	// One change's files can hold both sides of a cycle, so a narrowed run's cached cycle report is
	// re-read over the targets and the cache file that run used, not the whole tree's.
	it('re-reads a narrowed run through the cycle recheck it was given', async () => {
		mock_exit_codes(0, 1)
		mocked_verify.mockResolvedValueOnce({ output: '', exit_code: 0, elapsed_ms: 0 })

		const code = await run_lint_checks(
			['exec', 'prettier', TARGET],
			['exec', 'eslint', TARGET],
			RECHECK,
		)

		expect(mocked_verify).toHaveBeenCalledWith(expect.objectContaining({ exit_code: 1 }), RECHECK)
		expect(mocked_cache_run).toHaveBeenCalledWith(RECHECK.cache_file, expect.any(Function))
		expect(code).toBe(0)
	})
})

const NO_ESLINT_CONFIG = 'no ESLint configuration was found'
const NO_WEB_FILES = 'no HTML, CSS or JavaScript files were found'

function basic_project(): void {
	vi.spyOn(project_checks, 'is_basic').mockReturnValue(true)
	vi.spyOn(project_checks, 'prettier_skip_reason').mockReturnValue(undefined)
	vi.spyOn(project_checks, 'eslint_skip_reason').mockReturnValue(NO_ESLINT_CONFIG)
}

describe('basic project lint', () => {
	it('runs Prettier for HTML without configuration while skipping ESLint', async () => {
		basic_project()
		mocked_execa.mockResolvedValue(fake_result(0))
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await run_lint_parallel_checks()).toBe(0)
		expect(mocked_execa).toHaveBeenCalledOnce()
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining(NO_ESLINT_CONFIG))
	})

	it('skips Prettier when no web file exists', async () => {
		basic_project()
		vi.spyOn(project_checks, 'prettier_skip_reason').mockReturnValue(NO_WEB_FILES)
		vi.spyOn(project_checks, 'eslint_skip_reason').mockReturnValue(
			'no JavaScript or TypeScript files were found',
		)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await run_lint_parallel_checks()).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining(NO_WEB_FILES))
	})

	it('runs ESLint after its configuration is added', async () => {
		basic_project()
		vi.spyOn(project_checks, 'eslint_skip_reason').mockReturnValue(undefined)
		mock_exit_codes(0, 0)
		expect(await run_lint_parallel_checks()).toBe(0)
		expect(mocked_execa).toHaveBeenCalledTimes(2)
	})
})

describe('basic project lint over the changed files', () => {
	it('skips the same tools the whole-tree run skips', async () => {
		basic_project()
		vi.spyOn(project_checks, 'prettier_skip_reason').mockReturnValue(NO_WEB_FILES)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		const code = await run_lint_checks(['exec', 'prettier', 'a.py'], ['exec', 'eslint', 'a.py'], {
			cache_file: ESLINT_CACHE_FILE,
			patterns: ['a.py'],
		})

		expect(code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining(NO_ESLINT_CONFIG))
	})
})
