import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const { lint_parallel } = await import('./lint-parallel')
const { run_lint_checks, run_lint_parallel_checks } = lint_parallel
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

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

describe('run_lint_checks', () => {
	const TARGET = 'scripts/thing.ts'

	it('runs the targets it was given instead of the whole tree', async () => {
		const prettier_args = ['exec', 'prettier', '--check', TARGET]
		const eslint_args = ['exec', 'eslint', TARGET]

		mock_exit_codes(0, 0)

		await run_lint_checks(prettier_args, eslint_args)

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual(prettier_args)
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual(eslint_args)
	})
})
