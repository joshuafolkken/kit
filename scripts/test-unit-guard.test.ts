import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_unit_guard } from './test-unit-guard'
import { unit_worker_share } from './unit-worker-share'

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

const UNIT_TEST_BASENAME = 'sample.test.ts'
const COVERAGE_FLAG = '--coverage'
const UNIT_FILE = path.join('src', UNIT_TEST_BASENAME)

function fake_result(exit_code: number | undefined): ExecaResult {
	return { exitCode: exit_code } as unknown as ExecaResult
}

const ctx = { project_directory: '' }

// **Pinned rather than left real, because the real answer is what else is running on the machine**
// (joshuafolkken/kit#1515). `run_vitest` asks for this run's share of the workers and appends
// `--maxWorkers` when there is one, so a suite asserting the exact argument list would pass alone and
// fail beside a second lane — the class of flake this whole issue is about. Only the share is stubbed;
// the marker lifecycle around the spawn stays real, so the wrapper is still exercised.
function stub_share(share: number | undefined): void {
	vi.spyOn(unit_worker_share, 'current_share').mockReturnValue(share)
}

beforeEach(() => {
	vi.clearAllMocks()
	stub_share(undefined)
	ctx.project_directory = mkdtempSync(path.join(tmpdir(), 'unit-guard-'))
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(ctx.project_directory, { recursive: true, force: true })
})

function add_vitest_package(): void {
	const package_directory = path.join(ctx.project_directory, 'node_modules', 'vitest')

	mkdirSync(package_directory, { recursive: true })
	writeFileSync(path.join(package_directory, 'package.json'), '{}')
}

function add_unit_file(relative_path: string): void {
	const file_path = path.join(ctx.project_directory, relative_path)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, '')
}

describe('test_unit_guard.resolve_guard_action', () => {
	it('skips when the package is missing', () => {
		expect(test_unit_guard.resolve_guard_action(false, true)).toBe('skip-missing-package')
	})

	it('skips when no unit tests exist', () => {
		expect(test_unit_guard.resolve_guard_action(true, false)).toBe('skip-no-tests')
	})

	it('runs when the package and unit tests are both present', () => {
		expect(test_unit_guard.resolve_guard_action(true, true)).toBe('run')
	})
})

describe('test_unit_guard.is_vitest_installed', () => {
	it('returns false when vitest is absent', () => {
		expect(test_unit_guard.is_vitest_installed(ctx.project_directory)).toBe(false)
	})

	it('returns true when vitest is installed', () => {
		add_vitest_package()

		expect(test_unit_guard.is_vitest_installed(ctx.project_directory)).toBe(true)
	})
})

describe('test_unit_guard.has_unit_tests', () => {
	it('returns false when no *.test/*.spec files exist', () => {
		expect(test_unit_guard.has_unit_tests(ctx.project_directory)).toBe(false)
	})

	it('returns true when a *.test file exists under src/', () => {
		add_unit_file(UNIT_FILE)

		expect(test_unit_guard.has_unit_tests(ctx.project_directory)).toBe(true)
	})

	it('returns true when a *.spec file exists', () => {
		add_unit_file(path.join('src', 'sample.spec.ts'))

		expect(test_unit_guard.has_unit_tests(ctx.project_directory)).toBe(true)
	})

	it('ignores test files inside node_modules', () => {
		add_unit_file(path.join('node_modules', 'dep', UNIT_TEST_BASENAME))

		expect(test_unit_guard.has_unit_tests(ctx.project_directory)).toBe(false)
	})

	it('does not exclude directories whose name merely contains node_modules', () => {
		add_unit_file(path.join('src', 'node_modules_utils', UNIT_TEST_BASENAME))

		expect(test_unit_guard.has_unit_tests(ctx.project_directory)).toBe(true)
	})
})

describe('test_unit_guard.run_guarded_unit — skip paths', () => {
	it('skips and returns 0 when the package is missing', async () => {
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const exit_code = await test_unit_guard.run_guarded_unit(ctx.project_directory, [])

		expect(exit_code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('not installed'))
	})

	it('skips and returns 0 when no unit files exist', async () => {
		add_vitest_package()
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const exit_code = await test_unit_guard.run_guarded_unit(ctx.project_directory, [])

		expect(exit_code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('no *.{test,spec}'))
	})
})

// joshuafolkken/kit#1257: `josh test:related` prints what it narrowed by, and printing it before
// this guard has decided there will be a run would announce a run that never happens.
describe('test_unit_guard.run_guarded_vitest — the announcement', () => {
	const ANNOUNCEMENT = 'narrowed to 2 files'
	const RELATED_LABEL = 'test:related'

	it('is withheld when the guard skips', async () => {
		const write_spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await test_unit_guard.run_guarded_vitest(
			ctx.project_directory,
			['run'],
			RELATED_LABEL,
			ANNOUNCEMENT,
		)

		expect(write_spy).not.toHaveBeenCalled()
	})

	it('is printed when vitest is about to run', async () => {
		add_vitest_package()
		add_unit_file(UNIT_FILE)
		mocked_execa.mockResolvedValue(fake_result(0))
		const write_spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await test_unit_guard.run_guarded_vitest(
			ctx.project_directory,
			['run'],
			RELATED_LABEL,
			ANNOUNCEMENT,
		)

		expect(write_spy).toHaveBeenCalledWith(`${ANNOUNCEMENT}\n`)
	})
})

describe('test_unit_guard.run_guarded_unit — run path', () => {
	beforeEach(() => {
		add_vitest_package()
		add_unit_file(UNIT_FILE)
	})

	it('runs vitest and returns its exit code when both are present', async () => {
		mocked_execa.mockResolvedValue(fake_result(0))

		const exit_code = await test_unit_guard.run_guarded_unit(ctx.project_directory, [COVERAGE_FLAG])

		expect(exit_code).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', 'run', COVERAGE_FLAG],
			expect.objectContaining({ reject: false }),
		)
	})

	it('returns the fallback exit code when vitest reports no exit code', async () => {
		mocked_execa.mockResolvedValue(fake_result(undefined))

		const exit_code = await test_unit_guard.run_guarded_unit(ctx.project_directory, [])

		expect(exit_code).toBe(1)
	})

	// The pre-push hook is why this lives here rather than only in `josh gate`: it passed no cap at
	// all, so vitest opened one worker per core in every lane at once (joshuafolkken/kit#1515).
	it('narrows the worker pool when other unit runs share the machine', async () => {
		stub_share(2)
		mocked_execa.mockResolvedValue(fake_result(0))

		await test_unit_guard.run_guarded_unit(ctx.project_directory, [])

		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', 'run', '--maxWorkers=2'],
			expect.objectContaining({ reject: false }),
		)
	})
})
