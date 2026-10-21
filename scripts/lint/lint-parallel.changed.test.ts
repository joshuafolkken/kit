import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lint_parallel } from './lint-parallel'

// joshuafolkken/kit#4085: `josh lint --changed` is the gate's lint. Narrowed, it must still hand the
// changed files to both linters and fail on what they report; it must never narrow in CI.

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('#scripts/lane/lane-cache-run', () => ({
	lane_cache_run: {
		run: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => await work()),
	},
}))
vi.mock('./cross-file-recheck', () => ({
	cross_file_recheck: { verify: vi.fn(async (result: unknown) => await result) },
}))
vi.mock('./eslint-cache-dependencies', () => ({
	eslint_cache_dependencies: {
		guard: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => await work()),
	},
}))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const ROOT = process.cwd()
const CHANGED = path.join('scripts', 'lint', 'lint-parallel.ts')
const ABSOLUTE_CHANGED = path.join(ROOT, CHANGED)
const WHOLE_TREE = '.'
const FAILED = 1
const CHANGED_ARGUMENTS = ['--changed']

// The lint check reads only `all` and `exitCode` of execa's large result interface.
function fake_result(exit_code: number): ExecaResult {
	const result = { all: '', exitCode: exit_code }

	return result as unknown as ExecaResult
}

function mock_exit_codes(prettier_code: number, eslint_code: number): void {
	mocked_execa
		.mockResolvedValueOnce(fake_result(prettier_code))
		.mockResolvedValueOnce(fake_result(eslint_code))
}

function linter_arguments(): ReadonlyArray<ReadonlyArray<string>> {
	return mocked_execa.mock.calls.map((call) => (Array.isArray(call[1]) ? call[1] : []))
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.stubEnv('CI', '')
	vi.mocked(git_command.repository_root).mockResolvedValue(ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED])
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('lint_parallel.run_lint_command --changed', () => {
	it('hands both linters the changed file rather than the whole tree', async () => {
		mock_exit_codes(0, 0)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(0)

		for (const argv of linter_arguments()) {
			expect(argv).toContain(ABSOLUTE_CHANGED)
			expect(argv).not.toContain(WHOLE_TREE)
		}
	})

	it('fails on a violation eslint reports in the changed file', async () => {
		mock_exit_codes(0, FAILED)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(FAILED)
	})

	it('fails on a formatting violation prettier reports in the changed file', async () => {
		mock_exit_codes(FAILED, 0)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(FAILED)
	})

	it('lints the whole tree in CI', async () => {
		vi.stubEnv('CI', 'true')
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		for (const argv of linter_arguments()) expect(argv).toContain(WHOLE_TREE)
	})

	it('lints the whole tree when a configuration file changed', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED, 'eslint.config.js'])
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		for (const argv of linter_arguments()) expect(argv).toContain(WHOLE_TREE)
	})

	it('lints the whole tree without the flag', async () => {
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command([])

		for (const argv of linter_arguments()) expect(argv).toContain(WHOLE_TREE)
	})
})
