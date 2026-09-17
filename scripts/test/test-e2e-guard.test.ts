import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_e2e_guard } from './test-e2e-guard'

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

const E2E_BASENAME = 'home.e2e.ts'
const E2E_FILE = path.join('tests', E2E_BASENAME)

function fake_result(exit_code: number | undefined): ExecaResult {
	return { exitCode: exit_code } as unknown as ExecaResult
}

const ctx = { project_directory: '' }

beforeEach(() => {
	vi.clearAllMocks()
	ctx.project_directory = mkdtempSync(path.join(tmpdir(), 'e2e-guard-'))
})

afterEach(() => {
	rmSync(ctx.project_directory, { recursive: true, force: true })
})

function add_playwright_package(): void {
	const package_directory = path.join(ctx.project_directory, 'node_modules', '@playwright', 'test')

	mkdirSync(package_directory, { recursive: true })
	writeFileSync(path.join(package_directory, 'package.json'), '{}')
}

function add_e2e_file(relative_path: string): void {
	const file_path = path.join(ctx.project_directory, relative_path)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, '')
}

describe('test_e2e_guard.resolve_guard_action', () => {
	it('skips when the package is missing', () => {
		expect(test_e2e_guard.resolve_guard_action(false, true)).toBe('skip-missing-package')
	})

	it('skips when no e2e tests exist', () => {
		expect(test_e2e_guard.resolve_guard_action(true, false)).toBe('skip-no-tests')
	})

	it('runs when the package and e2e tests are both present', () => {
		expect(test_e2e_guard.resolve_guard_action(true, true)).toBe('run')
	})
})

describe('test_e2e_guard.is_playwright_installed', () => {
	it('returns false when @playwright/test is absent', () => {
		expect(test_e2e_guard.is_playwright_installed(ctx.project_directory)).toBe(false)
	})

	it('returns true when @playwright/test is installed', () => {
		add_playwright_package()

		expect(test_e2e_guard.is_playwright_installed(ctx.project_directory)).toBe(true)
	})
})

describe('test_e2e_guard.has_e2e_tests', () => {
	it('returns false when no *.e2e files exist', () => {
		expect(test_e2e_guard.has_e2e_tests(ctx.project_directory)).toBe(false)
	})

	it('returns true when an e2e test exists under tests/', () => {
		add_e2e_file(E2E_FILE)

		expect(test_e2e_guard.has_e2e_tests(ctx.project_directory)).toBe(true)
	})

	it('ignores e2e files inside node_modules', () => {
		add_e2e_file(path.join('node_modules', 'dep', 'sample.e2e.ts'))

		expect(test_e2e_guard.has_e2e_tests(ctx.project_directory)).toBe(false)
	})

	it('does not exclude directories whose name merely contains node_modules', () => {
		add_e2e_file(path.join('tests', 'node_modules_utils', E2E_BASENAME))

		expect(test_e2e_guard.has_e2e_tests(ctx.project_directory)).toBe(true)
	})
})

describe('test_e2e_guard.run_guarded_e2e — skip paths', () => {
	it('skips and returns 0 when the package is missing', async () => {
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const exit_code = await test_e2e_guard.run_guarded_e2e(ctx.project_directory, [])

		expect(exit_code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('not installed'))
	})

	it('skips and returns 0 when no e2e files exist', async () => {
		add_playwright_package()
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const exit_code = await test_e2e_guard.run_guarded_e2e(ctx.project_directory, [])

		expect(exit_code).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('no *.e2e'))
	})
})

describe('test_e2e_guard.run_guarded_e2e — run path', () => {
	beforeEach(() => {
		add_playwright_package()
		add_e2e_file(E2E_FILE)
	})

	it('runs Playwright and returns its exit code when both are present', async () => {
		mocked_execa.mockResolvedValue(fake_result(0))

		const exit_code = await test_e2e_guard.run_guarded_e2e(ctx.project_directory, [
			'--grep',
			'smoke',
		])

		expect(exit_code).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'playwright', 'test', '--grep', 'smoke'],
			expect.objectContaining({ reject: false }),
		)
	})

	it('returns the fallback exit code when Playwright reports no exit code', async () => {
		mocked_execa.mockResolvedValue(fake_result(undefined))

		const exit_code = await test_e2e_guard.run_guarded_e2e(ctx.project_directory, [])

		expect(exit_code).toBe(1)
	})
})
