import { PR_POLL_SCHEDULES } from '#scripts/lib/poll'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_pr_auto_merge } from './git-gh-pr-auto-merge'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'
import { git_pr_checks } from './git-pr-checks'
import { REQUIRED_CHECKS } from './git-pr-checks-eval'
import type { PrStateSnapshot } from './git-pr-checks-parse'
import { CHECKS_FAILED_MESSAGE, git_pr_checks_watch } from './git-pr-checks-watch'

// The merge-gate waits against a mocked `git_gh_pr_snapshot`: the observer each poll reports to
// (joshuafolkken/kit#3770), and the wait a flush runs once auto-merge is on (joshuafolkken/kit#2497).
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
const GREEN_STATE = {
	mergeStateStatus: 'CLEAN',
	statusCheckRollup: REQUIRED_CHECKS.map(function green(name: string): Record<string, string> {
		return { name, status: 'COMPLETED', conclusion: 'SUCCESS' }
	}),
}
const FAILING_CHECK = { name: 'E2E', status: 'COMPLETED', conclusion: 'FAILURE' }
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
	read_merged.mockResolvedValue(false)
	vi.mocked(git_gh_pr_snapshot.pr_get_review_decision).mockResolvedValue('')
})

afterEach(() => {
	vi.useRealTimers()
})

// An approved pull request with every required check green — what the observer describes poll.
function use_green_approved(): void {
	beforeEach(() => {
		vi.mocked(git_gh_pr_snapshot.pr_get_review_decision).mockResolvedValue('APPROVED')
		stub_state(GREEN_STATE)
	})
}

// `followup` reports each poll's checks to the run's event stream through the observer the wait is
// handed, so every snapshot the wait reads must reach it.
describe('git_pr_checks.wait_for_pr_success — observer', () => {
	use_green_approved()

	it('hands each polled snapshot to the observer', async () => {
		const observed: Array<PrStateSnapshot> = []

		async function observe(snapshot: PrStateSnapshot): Promise<void> {
			observed.push(snapshot)
		}

		const result = await git_pr_checks.wait_for_pr_success(BRANCH, 1, undefined, observe)

		expect(observed).toStrictEqual([result])
	})
})

// The watch polls for up to two minutes before the wait above, so a row re-entering followup after a
// red wait must see the new CI's pending checks from the watch rather than keep the old red line.
describe('git_pr_checks_watch.pr_checks_watch — observer', () => {
	use_green_approved()

	it('hands the watch poll snapshot to the observer', async () => {
		stub_state({ statusCheckRollup: [FAILING_CHECK] })
		const observed: Array<PrStateSnapshot> = []

		async function observe(snapshot: PrStateSnapshot): Promise<void> {
			observed.push(snapshot)
		}

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH, observe)).rejects.toThrow(
			CHECKS_FAILED_MESSAGE,
		)
		expect(observed).toHaveLength(1)
		expect(observed[0]?.rollup).toHaveLength(1)
	})
})

describe('git_pr_checks.read_merge_progress', () => {
	// joshuafolkken/kit#6721: one tick reads the pull request detail once, through the snapshot.
	it('answers merged from the one snapshot read, without a second merged read', async () => {
		stub_state({ ...PENDING_STATE, merged: true })

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('merged')
		expect(fetch_checks).toHaveBeenCalledTimes(1)
		expect(read_merged).not.toHaveBeenCalled()
	})

	it('asks whether the pull request merged only where the snapshot read failed', async () => {
		fetch_checks.mockRejectedValue(new Error(READ_FAILED))
		read_merged.mockResolvedValue(true)

		await expect(git_pr_checks.read_merge_progress(BRANCH)).resolves.toBe('merged')
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
	// #6868: the second read comes on the merge schedule's first wait, not the checks' lead.
	it('keeps polling while waiting and answers merged once GitHub merges', async () => {
		vi.useFakeTimers()
		stub_state(PENDING_STATE)

		const progress = git_pr_checks.wait_for_pr_merged(BRANCH)

		stub_state({ ...PENDING_STATE, merged: true })
		await vi.advanceTimersByTimeAsync(PR_POLL_SCHEDULES.merge.initial_ms)

		await expect(progress).resolves.toBe('merged')
		expect(fetch_checks).toHaveBeenCalledTimes(2)
	})

	it('stops at the first failed verdict rather than running out the budget', async () => {
		stub_state(CONFLICT_STATE)

		await expect(git_pr_checks.wait_for_pr_merged(BRANCH)).resolves.toBe('failed')
		expect(fetch_checks).toHaveBeenCalledTimes(1)
	})
})
