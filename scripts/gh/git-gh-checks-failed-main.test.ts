import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_checks_failed } from './git-gh-checks-failed'
import { main } from './git-gh-checks-failed-main'

vi.mock('./git-gh-checks-failed', () => ({
	git_gh_checks_failed: { report: vi.fn() },
}))

const mocked_report = vi.mocked(git_gh_checks_failed.report)

const SHA = 'abc1234'
const NOTHING_FAILED = `No failing checks on ${SHA}.`
const RATE_LIMITED = 'rate limited'

beforeEach(() => {
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	vi.spyOn(console, 'error').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	process.exitCode = undefined
})

describe('checks:failed main', () => {
	it('prints the report for the given target and leaves the exit code at 0', async () => {
		mocked_report.mockResolvedValue(NOTHING_FAILED)

		await main([SHA])

		expect(mocked_report).toHaveBeenCalledWith(SHA)
		expect(console.info).toHaveBeenCalledWith(NOTHING_FAILED)
		expect(process.exitCode).toBeUndefined()
	})

	it('prints the error and exits 1 when the checks cannot be read', async () => {
		mocked_report.mockRejectedValue(new Error(RATE_LIMITED))

		await main([])

		expect(console.error).toHaveBeenCalledWith(RATE_LIMITED)
		expect(process.exitCode).toBe(1)
	})
})
