import { PrConflictError } from '#scripts/gh/git-pr-checks-eval'
import { MissingContextError } from '#scripts/gh/git-pr-checks-missing'
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

vi.mock('./followup-run-rerun', () => ({
	followup_run_rerun: { recover_missing: vi.fn() },
}))

const { git_pr_checks } = await import('#scripts/gh/git-pr-checks')
const { followup_job_rerun } = await import('./followup-job-rerun')
const { followup_run_rerun } = await import('./followup-run-rerun')

const BRANCH_NAME = '4813-lane'
const CHECKS_FAILURE = 'PR checks failed (failed checks: Detect E2E).'
const MISSING_FAILURE = 'PR checks failed (required context Checks has no check-run).'
const MISSING = { contexts: ['Checks'], head_sha: 'abc123' }
const RERUN_NAMES = ['Detect E2E']
const SNAPSHOT = { rollup: [], merge_state_status: undefined, review_decision: undefined }

const wait = vi.mocked(git_pr_checks.wait_for_pr_success)
const rerun = vi.mocked(followup_job_rerun.rerun_failed_jobs)
const recover = vi.mocked(followup_run_rerun.recover_missing)

async function run(reran: Array<string> = []): Promise<unknown> {
	return await run_checks({ branch_name: BRANCH_NAME, is_skip_watch: true, reran })
}

function missing_error(): MissingContextError {
	return new MissingContextError(MISSING_FAILURE, { missing: MISSING })
}

beforeEach(() => {
	wait.mockReset()
	rerun.mockReset()
	recover.mockReset()
})

// joshuafolkken/kit#5778: a required job a partial rerun dropped leaves no failed job to retry.
describe('run_checks — a required context with no check-run', () => {
	it('reruns the whole run once, not the failed jobs, and waits again', async () => {
		const reran: Array<string> = []

		wait.mockRejectedValueOnce(missing_error()).mockResolvedValueOnce(SNAPSHOT)
		recover.mockResolvedValue('rerun')

		await expect(run(reran)).resolves.toStrictEqual(SNAPSHOT)
		expect(recover).toHaveBeenCalledExactlyOnceWith(MISSING)
		expect(rerun).not.toHaveBeenCalled()
		expect(reran).toStrictEqual(MISSING.contexts)
	})

	it('waits again without a rerun when the job only trailed', async () => {
		const reran: Array<string> = []

		wait.mockRejectedValueOnce(missing_error()).mockResolvedValueOnce(SNAPSHOT)
		recover.mockResolvedValue('present')

		await expect(run(reran)).resolves.toStrictEqual(SNAPSHOT)
		expect(reran).toStrictEqual([])
	})

	it('fails with the original failure when nothing recovers it', async () => {
		const error = missing_error()

		wait.mockRejectedValue(error)
		recover.mockResolvedValue('none')

		await expect(run()).rejects.toBe(error)
		expect(wait).toHaveBeenCalledOnce()
	})

	it('does not recover a second time when the context is missing again', async () => {
		wait.mockRejectedValue(missing_error())
		recover.mockResolvedValue('rerun')

		await expect(run()).rejects.toThrow(MISSING_FAILURE)
		expect(recover).toHaveBeenCalledOnce()
	})
})

describe('run_checks — a stalled job is rerun once', () => {
	it('waits again and passes when the rerun went green', async () => {
		wait.mockRejectedValueOnce(new Error(CHECKS_FAILURE)).mockResolvedValueOnce(SNAPSHOT)
		rerun.mockResolvedValue(RERUN_NAMES)

		await expect(run()).resolves.toStrictEqual(SNAPSHOT)
		expect(rerun).toHaveBeenCalledExactlyOnceWith(BRANCH_NAME)
		expect(wait).toHaveBeenCalledTimes(2)
	})

	// joshuafolkken/kit#5545: the rerun names reach the completion notification's check report.
	it('records the rerun jobs in the collector it was handed', async () => {
		const reran: Array<string> = []

		wait.mockRejectedValueOnce(new Error(CHECKS_FAILURE)).mockResolvedValueOnce(SNAPSHOT)
		rerun.mockResolvedValue(RERUN_NAMES)

		await run_checks({ branch_name: BRANCH_NAME, is_skip_watch: true, reran })

		expect(reran).toStrictEqual(RERUN_NAMES)
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
