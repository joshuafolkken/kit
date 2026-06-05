import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const { run_lint_parallel_checks } = await import('./lint-parallel')
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

describe('run_lint_parallel_checks', () => {
	it('returns 0 when both prettier and eslint pass', async () => {
		mock_exit_codes(0, 0)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(0)
	})

	it('returns 1 when prettier fails', async () => {
		mock_exit_codes(1, 0)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})

	it('returns 1 when eslint fails', async () => {
		mock_exit_codes(0, 1)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})

	it('returns 1 when both fail', async () => {
		mock_exit_codes(1, 1)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})
})
