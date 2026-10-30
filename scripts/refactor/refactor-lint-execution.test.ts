import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refactor_lint } from './refactor-lint'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('execa', () => ({ execa: execute }))

const ROOT = '/repo'
const FILES = ['scripts/a.ts']
const STDERR = 'ESLint configuration failed'
const SPAWN_ERROR = 'spawn eslint ENOENT'

beforeEach(() => {
	vi.resetAllMocks()
})

describe('refactor lint execution', () => {
	it('does not spawn ESLint for an empty scope', async () => {
		expect(await refactor_lint.scan_categories([], ROOT)).toHaveLength(
			refactor_lint.CATEGORIES.length,
		)
		expect(execute).not.toHaveBeenCalled()
	})

	it('accepts lint findings with exit code one and preserves their locations', async () => {
		const stdout = JSON.stringify([
			{ filePath: '/repo/scripts/a.ts', messages: [{ ruleId: 'max-lines', line: 1 }] },
		])

		execute.mockResolvedValue({ stdout, stderr: '', failed: true, exitCode: 1 })
		const categories = await refactor_lint.scan_categories(FILES, ROOT)

		expect(categories[0]?.candidates).toStrictEqual([
			{ location: 'scripts/a.ts:1', rule: 'max-lines' },
		])
		expect(execute).toHaveBeenCalledWith(
			expect.any(String),
			['exec', 'eslint', '--format', 'json', ...FILES],
			expect.objectContaining({ cwd: ROOT, timeout: SUITE_TIMEOUT_MS, stderr: 'pipe' }),
		)
	})
})

describe('refactor lint execution failures', () => {
	it('preserves startup failures', async () => {
		execute.mockRejectedValue(new Error(SPAWN_ERROR))

		await expect(refactor_lint.scan_categories(FILES, ROOT)).rejects.toThrow('ENOENT')
	})

	it('preserves timeout evidence even if stdout contains valid JSON', async () => {
		execute.mockResolvedValue({
			stdout: '[]',
			stderr: '',
			failed: true,
			timedOut: true,
			exitCode: 1,
			message: 'Command timed out after 180000 milliseconds: eslint',
		})

		await expect(refactor_lint.scan_categories(FILES, ROOT)).rejects.toThrow('timed out')
	})

	it('preserves ESLint execution failures and stderr', async () => {
		execute.mockResolvedValue({ failed: true, exitCode: 2, stderr: STDERR })

		await expect(refactor_lint.scan_categories(FILES, ROOT)).rejects.toThrow(STDERR)
	})

	it('preserves the operating system error of a failed non-rejecting spawn', async () => {
		execute.mockResolvedValue({
			failed: true,
			code: 'ENOENT',
			originalMessage: SPAWN_ERROR,
		})

		await expect(refactor_lint.scan_categories(FILES, ROOT)).rejects.toThrow(SPAWN_ERROR)
	})

	it.each(['not json', '{}'])('diagnoses invalid output %s with stderr', async (stdout) => {
		execute.mockResolvedValue({ stdout, stderr: STDERR, failed: false, exitCode: 0 })

		await expect(refactor_lint.scan_categories(FILES, ROOT)).rejects.toThrow(
			`Invalid ESLint JSON output: ${stdout}\n${STDERR}`,
		)
	})
})

describe('refactor lint interrupted execution', () => {
	it.each([{ isCanceled: true }, { isMaxBuffer: true }, { isTerminated: true }])(
		'rejects interrupted execution with exit one: %j',
		async (failure) => {
			execute.mockResolvedValue({ stdout: '[]', stderr: '', failed: true, exitCode: 1, ...failure })

			await expect(refactor_lint.scan_categories(FILES, ROOT)).rejects.toThrow(
				'ESLint execution failed',
			)
		},
	)
})
