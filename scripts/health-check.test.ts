import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckStatus } from './health-check'

vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
}))

type CloseListener = (code: number) => void

interface FakeProcess {
	on: (event: 'close', listener: CloseListener) => void
}

function make_fake_process(exit_code: number): FakeProcess {
	return {
		on(_event: 'close', listener: CloseListener) {
			setTimeout(() => {
				listener(exit_code)
			}, 0)
		},
	}
}

const { health_check } = await import('./health-check')
const { classify_exit, run_health_check, status_icon } = health_check
const child_process_module = await import('node:child_process')
const mocked_spawn = vi.mocked(child_process_module.spawn)

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
		mocked_spawn.mockReturnValueOnce(
			make_fake_process(0) as ReturnType<typeof child_process_module.spawn>,
		)

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
		mocked_spawn.mockReturnValueOnce(
			make_fake_process(1) as ReturnType<typeof child_process_module.spawn>,
		)

		const result = await run_health_check({
			label: 'eslint',
			cmd: 'pnpm',
			cmd_args: ['exec', 'eslint', '.'],
		})

		expect(result).toEqual({ label: 'eslint', status: 'fail' satisfies CheckStatus })
	})

	it('returns warn status when process exits non-zero with warn_on_fail', async () => {
		mocked_spawn.mockReturnValueOnce(
			make_fake_process(1) as ReturnType<typeof child_process_module.spawn>,
		)

		const result = await run_health_check({
			label: 'security',
			cmd: 'pnpm',
			cmd_args: ['audit'],
			warn_on_fail: true,
		})

		expect(result).toEqual({ label: 'security', status: 'warn' satisfies CheckStatus })
	})
})
