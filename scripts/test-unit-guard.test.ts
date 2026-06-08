import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_unit_guard } from './test-unit-guard'

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

const UNIT_TEST_BASENAME = 'sample.test.ts'
const COVERAGE_FLAG = '--coverage'
const UNIT_FILE = path.join('src', UNIT_TEST_BASENAME)

function fake_result(exit_code: number | undefined): ExecaResult {
	return { exitCode: exit_code } as unknown as ExecaResult
}

let project_directory = ''

beforeEach(() => {
	vi.clearAllMocks()
	project_directory = mkdtempSync(path.join(tmpdir(), 'unit-guard-'))
})

afterEach(() => {
	rmSync(project_directory, { recursive: true, force: true })
})

function add_vitest_package(): void {
	const package_directory = path.join(project_directory, 'node_modules', 'vitest')

	mkdirSync(package_directory, { recursive: true })
	writeFileSync(path.join(package_directory, 'package.json'), '{}')
}

function add_unit_file(relative_path: string): void {
	const file_path = path.join(project_directory, relative_path)

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
		expect(test_unit_guard.is_vitest_installed(project_directory)).toBe(false)
	})

	it('returns true when vitest is installed', () => {
		add_vitest_package()

		expect(test_unit_guard.is_vitest_installed(project_directory)).toBe(true)
	})
})

describe('test_unit_guard.has_unit_tests', () => {
	it('returns false when no *.test/*.spec files exist', () => {
		expect(test_unit_guard.has_unit_tests(project_directory)).toBe(false)
	})

	it('returns true when a *.test file exists under src/', () => {
		add_unit_file(UNIT_FILE)

		expect(test_unit_guard.has_unit_tests(project_directory)).toBe(true)
	})

	it('returns true when a *.spec file exists', () => {
		add_unit_file(path.join('src', 'sample.spec.ts'))

		expect(test_unit_guard.has_unit_tests(project_directory)).toBe(true)
	})

	it('ignores test files inside node_modules', () => {
		add_unit_file(path.join('node_modules', 'dep', UNIT_TEST_BASENAME))

		expect(test_unit_guard.has_unit_tests(project_directory)).toBe(false)
	})
})

describe('test_unit_guard.run_guarded_unit — skip paths', () => {
	it('skips and returns 0 when the package is missing', async () => {
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const exit_code = await test_unit_guard.run_guarded_unit(project_directory, [])

		expect(exit_code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('not installed'))
	})

	it('skips and returns 0 when no unit files exist', async () => {
		add_vitest_package()
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const exit_code = await test_unit_guard.run_guarded_unit(project_directory, [])

		expect(exit_code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('no *.{test,spec}'))
	})
})

describe('test_unit_guard.run_guarded_unit — run path', () => {
	beforeEach(() => {
		add_vitest_package()
		add_unit_file(UNIT_FILE)
	})

	it('runs vitest and returns its exit code when both are present', async () => {
		mocked_execa.mockResolvedValue(fake_result(0))

		const exit_code = await test_unit_guard.run_guarded_unit(project_directory, [COVERAGE_FLAG])

		expect(exit_code).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', 'run', COVERAGE_FLAG],
			expect.objectContaining({ reject: false }),
		)
	})

	it('returns the fallback exit code when vitest reports no exit code', async () => {
		mocked_execa.mockResolvedValue(fake_result(undefined))

		const exit_code = await test_unit_guard.run_guarded_unit(project_directory, [])

		expect(exit_code).toBe(1)
	})
})
