import { project_checks } from '#scripts/gate/project-checks'
import {
	ESLINT_CACHE_FILE,
	PRETTIER_CACHE_FILE,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
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
vi.mock('./eslint-daemon', () => ({ eslint_daemon: { run_or_cold: vi.fn() } }))
vi.mock('./eslint-cache-dependencies', () => ({
	eslint_cache_dependencies: {
		guard: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => await work()),
	},
}))

const { eslint_cache_dependencies } = await import('./eslint-cache-dependencies')
const mocked_guard = vi.mocked(eslint_cache_dependencies.guard)
const { eslint_daemon } = await import('./eslint-daemon')
const mocked_run_or_cold = vi.mocked(eslint_daemon.run_or_cold)
const { ESLINT_ARGS, lint_parallel, PRETTIER_ARGS } = await import('./lint-parallel')
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

	// joshuafolkken/kit#3948: prettier hashes each file's absolute path into its cache entry, so a
	// cache imported from another checkout misses on every file — it is cached, never shared.
	it('checks prettier from its own content cache without sharing it', async () => {
		mock_exit_codes(0, 0)

		await run_lint_parallel_checks()

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual(PRETTIER_ARGS)
		expect(PRETTIER_ARGS.join(' ')).toContain(PRETTIER_CACHE_FLAGS.join(' '))
		expect(mocked_cache_run).not.toHaveBeenCalledWith(PRETTIER_CACHE_FILE, expect.any(Function))
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

// joshuafolkken/kit#4581: a worker per runner core (#4579) did not shorten CI's lint over five runs,
// so the whole-tree eslint stays single-threaded in CI as it is locally.
describe('whole-tree eslint in CI', () => {
	it('hands eslint the same arguments as a local run', async () => {
		vi.stubEnv('CI', 'true')
		mock_exit_codes(0, 0)

		await run_lint_parallel_checks()
		vi.unstubAllEnvs()

		expect(mocked_execa.mock.calls[1]?.[1]).toEqual(ESLINT_ARGS)
	})
})

const TARGET = 'scripts/thing.ts'
const RELATED_CACHE_FILE = '.eslintcache.related'

describe('run_lint_checks', () => {
	it('runs the targets it was given instead of the whole tree', async () => {
		const prettier_args = ['exec', 'prettier', '--check', TARGET]
		const eslint_args = ['exec', 'eslint', TARGET]

		mock_exit_codes(0, 0)

		await run_lint_checks(prettier_args, eslint_args, RELATED_CACHE_FILE)

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual(prettier_args)
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual(eslint_args)
	})

	// joshuafolkken/kit#4415: the entries whose imports changed are dropped from the cache file the
	// narrowed run reads — that run's own file, not the whole tree's — and the run exits on its report.
	it('runs eslint inside the dependency guard of the cache file it was given', async () => {
		mock_exit_codes(0, 1)

		const code = await run_lint_checks(
			['exec', 'prettier', TARGET],
			['exec', 'eslint', TARGET],
			RELATED_CACHE_FILE,
		)

		expect(mocked_cache_run).toHaveBeenCalledWith(RELATED_CACHE_FILE, expect.any(Function))
		expect(mocked_guard).toHaveBeenCalledWith(RELATED_CACHE_FILE, expect.any(Function))
		expect(code).toBe(1)
	})
})

// joshuafolkken/kit#4358: only a run that asks for it reaches the warm daemon; the fallback to the
// cold process is `eslint_daemon.run_or_cold`'s own.
describe('run_lint_checks — the warm eslint daemon', () => {
	const ESLINT = ['exec', 'eslint', TARGET]
	const PRETTIER = ['exec', 'prettier', TARGET]
	const WARM = { warm_daemon: true }

	it('lints through the daemon when asked, spawning only prettier', async () => {
		mocked_execa.mockResolvedValueOnce(fake_result(0))
		mocked_run_or_cold.mockResolvedValueOnce({ exit_code: 1, output: 'x', elapsed_ms: 0 })
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await run_lint_checks(PRETTIER, ESLINT, RELATED_CACHE_FILE, WARM)).toBe(1)
		expect(mocked_run_or_cold).toHaveBeenCalledWith(ESLINT)
		expect(mocked_execa).toHaveBeenCalledOnce()
	})

	it('never reaches the daemon unless asked', async () => {
		mocked_execa.mockResolvedValue(fake_result(0))

		await run_lint_checks(PRETTIER, ESLINT, RELATED_CACHE_FILE)
		await run_lint_parallel_checks()

		expect(mocked_run_or_cold).not.toHaveBeenCalled()
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

describe('basic project lint — a tool that ran clean beside a skipped one', () => {
	it('says ESLint ran when it is clean beside a skipped Prettier', async () => {
		basic_project()
		vi.spyOn(project_checks, 'prettier_skip_reason').mockReturnValue(NO_WEB_FILES)
		vi.spyOn(project_checks, 'eslint_skip_reason').mockReturnValue(undefined)
		mocked_execa.mockResolvedValue(fake_result(0))
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await run_lint_parallel_checks()).toBe(0)
		expect(stdout).toHaveBeenCalledWith(`${project_checks.ran_notice('eslint')}\n`)
	})

	it('adds no notice for a failing tool beside a skipped one', async () => {
		basic_project()
		mocked_execa.mockResolvedValue(fake_result(1))
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await run_lint_parallel_checks()).toBe(1)
		expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining('ran and reported'))
	})

	it('adds no notice when neither tool is skipped', async () => {
		vi.spyOn(project_checks, 'prettier_skip_reason').mockReturnValue(undefined)
		vi.spyOn(project_checks, 'eslint_skip_reason').mockReturnValue(undefined)
		mock_exit_codes(0, 0)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await run_lint_parallel_checks()).toBe(0)
		expect(stdout).not.toHaveBeenCalled()
	})
})

describe('basic project lint over the changed files', () => {
	it('skips the same tools the whole-tree run skips', async () => {
		basic_project()
		vi.spyOn(project_checks, 'prettier_skip_reason').mockReturnValue(NO_WEB_FILES)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		const code = await run_lint_checks(
			['exec', 'prettier', 'a.py'],
			['exec', 'eslint', 'a.py'],
			ESLINT_CACHE_FILE,
		)

		expect(code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining(NO_ESLINT_CONFIG))
	})
})
