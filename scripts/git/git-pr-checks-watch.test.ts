import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_checks_watch, is_timeout_error } from './git-pr-checks-watch'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

function fake_success(): ExecaResult {
	const result = { exitCode: 0 }

	return result as unknown as ExecaResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

const BRANCH = 'feature'

describe('is_timeout_error', () => {
	it('returns true for an error with timedOut: true', () => {
		expect(is_timeout_error(Object.assign(new Error('x'), { timedOut: true }))).toBe(true)
	})

	it('returns false for a non-timeout error', () => {
		expect(is_timeout_error(Object.assign(new Error('x'), { exitCode: 1 }))).toBe(false)
	})

	it('returns false for a non-object value', () => {
		expect(is_timeout_error('nope')).toBe(false)
	})
})

describe('git_pr_checks_watch.pr_checks_watch', () => {
	it('resolves with timed_out: false when the watch succeeds', async () => {
		mocked_execa.mockResolvedValueOnce(fake_success())

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).resolves.toStrictEqual({
			timed_out: false,
		})
	})

	it('resolves with timed_out: true when execa reports a timeout', async () => {
		mocked_execa.mockRejectedValueOnce(Object.assign(new Error('timed out'), { timedOut: true }))

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).resolves.toStrictEqual({
			timed_out: true,
		})
	})

	it('throws with the exit code when the watch exits non-zero', async () => {
		mocked_execa.mockRejectedValueOnce(Object.assign(new Error('failed'), { exitCode: 1 }))

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).rejects.toThrow('exited with code 1')
	})

	it('rethrows a spawn error that has no exit code', async () => {
		const spawn_error_message = 'spawn ENOENT'

		mocked_execa.mockRejectedValueOnce(
			Object.assign(new Error(spawn_error_message), { code: 'ENOENT' }),
		)

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH)).rejects.toThrow(spawn_error_message)
	})
})
