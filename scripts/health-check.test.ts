import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckStatus } from './health-check'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const { health_check } = await import('./health-check')
const { classify_exit, run_health_check, status_icon } = health_check
const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

function fake_exit(exit_code: number): ExecaResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('status_icon', () => {
	it('returns ✔ for pass', () => {
		expect(status_icon('pass')).toBe('✔')
	})

	it('returns ⚠ for warn', () => {
		expect(status_icon('warn')).toBe('⚠')
	})

	it('returns ✗ for fail', () => {
		expect(status_icon('fail')).toBe('✗')
	})
})

describe('classify_exit', () => {
	it('returns pass when exit code is 0', () => {
		expect(classify_exit(0, false)).toBe('pass')
	})

	it('returns fail when non-zero and warn_on_fail is false', () => {
		expect(classify_exit(1, false)).toBe('fail')
	})

	it('returns warn when non-zero and warn_on_fail is true', () => {
		expect(classify_exit(1, true)).toBe('warn')
	})

	it('returns pass for exit code 0 regardless of warn_on_fail', () => {
		expect(classify_exit(0, true)).toBe('pass')
	})
})

describe('run_health_check — exit 0', () => {
	it('returns pass status when process exits with 0', async () => {
		mocked_execa.mockResolvedValueOnce(fake_exit(0))

		const result = await run_health_check({
			label: 'prettier',
			cmd: 'pnpm',
			cmd_args: ['exec', 'prettier', '--check', '.'],
		})

		expect(result).toEqual({ label: 'prettier', status: 'pass' satisfies CheckStatus })
	})
})

describe('run_health_check — exit non-zero', () => {
	it('returns fail status when process exits non-zero without warn_on_fail', async () => {
		mocked_execa.mockResolvedValueOnce(fake_exit(1))

		const result = await run_health_check({
			label: 'eslint',
			cmd: 'pnpm',
			cmd_args: ['exec', 'eslint', '.'],
		})

		expect(result).toEqual({ label: 'eslint', status: 'fail' satisfies CheckStatus })
	})

	it('returns warn status when process exits non-zero with warn_on_fail', async () => {
		mocked_execa.mockResolvedValueOnce(fake_exit(1))

		const result = await run_health_check({
			label: 'security',
			cmd: 'pnpm',
			cmd_args: ['audit'],
			warn_on_fail: true,
		})

		expect(result).toEqual({ label: 'security', status: 'warn' satisfies CheckStatus })
	})
})
