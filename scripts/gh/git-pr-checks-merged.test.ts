import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_pr_auto_merge } from './git-gh-pr-auto-merge'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'
import { CHECK_WAIT_INTERVAL_MS, git_pr_checks } from './git-pr-checks'
import { REQUIRED_CHECKS } from './git-pr-checks-eval'

// joshuafolkken/kit#2497. The wait a flush runs once auto-merge is on: `merged` ends it, the merge
// gate's own failure verdict ends it early, and a read that failed keeps it polling.
vi.mock('./git-gh-pr-auto-merge', () => ({
	git_gh_pr_auto_merge: { pr_is_merged: vi.fn() },
}))
vi.mock('./git-gh-pr-snapshot', () => ({
	git_gh_pr_snapshot: {
		pr_get_checks_snapshot: vi.fn(),
		pr_get_review_decision: vi.fn(),
	},
}))

const read_merged = vi.mocked(git_gh_pr_auto_merge.pr_is_merged)
const fetch_checks = vi.mocked(git_gh_pr_snapshot.pr_get_checks_snapshot)

const BRANCH = 'observations/2026-09-24-010203'
const PR_NUMBER = 2497
const READ_FAILED = 'gh unavailable'
const PENDING_STATE = { mergeStateStatus: 'BLOCKED', statusCheckRollup: [] }
const CONFLICT_STATE = { mergeStateStatus: 'DIRTY', statusCheckRollup: [] }
const RED_CONCLUSION = { status: 'COMPLETED', conclusion: 'FAILURE' }
const REQUIRED_RED_STATE = {
	mergeStateStatus: 'UNSTABLE',
	statusCheckRollup: [{ name: REQUIRED_CHECKS[0], ...RED_CONCLUSION }],
}
const OPTIONAL_RED_STATE = {
	mergeStateStatus: 'UNSTABLE',
	statusCheckRollup: [{ name: 'lint-optional', ...RED_CONCLUSION }],
}

function stub_state(state: Record<string, unknown>): void {
	fetch_checks.mockResolvedValue({ pr_number: PR_NUMBER, snapshot_json: JSON.stringify(state) })
}

beforeEach(() => {
	vi.clearAllMocks()
	read_merged.mockResolvedValue(false)
	vi.mocked(git_gh_pr_snapshot.pr_get_review_decision).mockResolvedValue('')
})

afterEach(() => {
	vi.useRealTimers()
})

describe('git_pr_checks.read_merge_progress', () => {
	it('answers merged once the pull request reads back merged, without reading the gate', async () => {
		read_merged.mockResolvedValue(true)

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('merged')
		expect(fetch_checks).not.toHaveBeenCalled()
	})

	it('answers failed when the merge gate fails the pull request', async () => {
		stub_state(CONFLICT_STATE)

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('failed')
	})

	it('answers failed when a required check fails', async () => {
		stub_state(REQUIRED_RED_STATE)

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('failed')
	})

	it('answers waiting when only a check outside the required list fails, as auto-merge still fires', async () => {
		stub_state(OPTIONAL_RED_STATE)

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('waiting')
	})

	it('answers waiting while the checks are still running', async () => {
		stub_state(PENDING_STATE)

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('waiting')
	})

	it('answers waiting for a gate read that failed, so a poll asks again', async () => {
		fetch_checks.mockRejectedValue(new Error(READ_FAILED))

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('waiting')
	})
})

describe('git_pr_checks.wait_for_pr_merged', () => {
	it('keeps polling while waiting and answers merged once GitHub merges', async () => {
		vi.useFakeTimers()
		stub_state(PENDING_STATE)
		read_merged.mockResolvedValueOnce(false).mockResolvedValue(true)

		const progress = git_pr_checks.wait_for_pr_merged(BRANCH)

		await vi.advanceTimersByTimeAsync(CHECK_WAIT_INTERVAL_MS)

		await expect(progress).resolves.toBe('merged')
		expect(read_merged).toHaveBeenCalledTimes(2)
	})

	it('stops at the first failed verdict rather than running out the budget', async () => {
		stub_state(CONFLICT_STATE)

		await expect(git_pr_checks.wait_for_pr_merged(BRANCH)).resolves.toBe('failed')
		expect(read_merged).toHaveBeenCalledTimes(1)
	})
})
