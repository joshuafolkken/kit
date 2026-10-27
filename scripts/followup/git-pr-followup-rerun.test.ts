import { PrConflictError } from '#scripts/gh/git-pr-checks-eval'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_checks } from './git-pr-followup'

// joshuafolkken/kit#4813: a CI job the runner stopped after every step passed is rerun once and the
// wait judged again. Which job qualifies is `followup-job-rerun.test.ts`'s question; this suite pins
// when `run_checks` asks it and what it does with the answer.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_checks_watch: vi.fn(), pr_get_checks_snapshot: vi.fn() },
}))

vi.mock('#scripts/gh/git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
	DEFAULT_STABLE_READS: 2,
	WATCH_CONFIRMED_STABLE_READS: 1,
}))

vi.mock('#scripts/issue/issue-watch-gate', () => ({
	issue_watch_gate: { assert_read_here: vi.fn() },
}))

vi.mock('./followup-job-rerun', () => ({
	followup_job_rerun: { rerun_failed_jobs: vi.fn() },
}))

const { git_pr_checks } = await import('#scripts/gh/git-pr-checks')
const { followup_job_rerun } = await import('./followup-job-rerun')

const BRANCH_NAME = '4813-lane'
const CHECKS_FAILURE = 'PR checks failed (failed checks: Detect E2E).'
const RERUN_NAMES = ['Detect E2E']
const SNAPSHOT = { rollup: [], merge_state_status: undefined, review_decision: undefined }

const wait = vi.mocked(git_pr_checks.wait_for_pr_success)
const rerun = vi.mocked(followup_job_rerun.rerun_failed_jobs)

async function run(): Promise<unknown> {
	return await run_checks({ branch_name: BRANCH_NAME, is_skip_watch: true })
}

beforeEach(() => {
	wait.mockReset()
	rerun.mockReset()
})

describe('run_checks — a stalled job is rerun once', () => {
	it('waits again and passes when the rerun went green', async () => {
		wait.mockRejectedValueOnce(new Error(CHECKS_FAILURE)).mockResolvedValueOnce(SNAPSHOT)
		rerun.mockResolvedValue(RERUN_NAMES)

		await expect(run()).resolves.toStrictEqual(SNAPSHOT)
		expect(rerun).toHaveBeenCalledExactlyOnceWith(BRANCH_NAME)
		expect(wait).toHaveBeenCalledTimes(2)
	})

	it('fails as before when the rerun failed again, without a second rerun', async () => {
		wait.mockRejectedValue(new Error(CHECKS_FAILURE))
		rerun.mockResolvedValue(RERUN_NAMES)

		await expect(run()).rejects.toThrow(CHECKS_FAILURE)
		expect(rerun).toHaveBeenCalledOnce()
	})

	it('fails with the original failure when no job qualified', async () => {
		wait.mockRejectedValue(new Error(CHECKS_FAILURE))
		rerun.mockResolvedValue([])

		await expect(run()).rejects.toThrow(CHECKS_FAILURE)
		expect(wait).toHaveBeenCalledOnce()
	})
})

describe('run_checks — failures no rerun can clear', () => {
	it.each([
		['a merge conflict', new PrConflictError(CHECKS_FAILURE)],
		['a timeout', new Error('Timed out while waiting for PR checks to complete.')],
	])('does not look for a rerun on %s', async (_label, error) => {
		wait.mockRejectedValue(error)

		await expect(run()).rejects.toBe(error)
		expect(rerun).not.toHaveBeenCalled()
	})
})
