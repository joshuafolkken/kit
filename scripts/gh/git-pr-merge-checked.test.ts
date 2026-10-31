import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_command } from './git-gh-command'
import { git_pr_checks, type PrStateSnapshot } from './git-pr-checks'
import {
	git_pr_merge_checked,
	HEAD_KEPT_MOVING_MESSAGE,
	MAX_HEAD_MOVES,
	NO_CHECKED_HEAD_MESSAGE,
	type WaitForGreen,
} from './git-pr-merge-checked'

// #4036: a merge names the head the merge gate passed. A push between the two answers 409, and the
// merge goes back to waiting on the new head instead of failing — or merging what nobody checked.

vi.mock('./git-gh-command', () => ({
	git_gh_command: { pr_merge: vi.fn(), is_head_moved: vi.fn() },
}))

vi.mock('./git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
}))

const BRANCH = 'feature-branch'
const CHECKED_SHA = 'c0ffee1'
const PUSHED_SHA = 'beef002'
const HEAD_MOVED = new Error('gh: Head branch was modified (HTTP 409)')
const MERGE_REFUSED = new Error('gh: Pull Request is not mergeable (HTTP 405)')

const mocked_merge = vi.mocked(git_gh_command.pr_merge)
const mocked_wait = vi.mocked(git_pr_checks.wait_for_pr_success)

function snapshot_at(head_sha?: string): PrStateSnapshot {
	const snapshot = { rollup: [], merge_state_status: 'CLEAN', review_decision: undefined }

	return head_sha === undefined ? snapshot : { ...snapshot, head_sha }
}

function merged_shas(): Array<string> {
	return mocked_merge.mock.calls.map(([, sha]) => sha)
}

// A merge of the snapshot the gate already passed at `CHECKED_SHA`, unless `checked` says otherwise.
async function merge_checked(
	wait_for_green: WaitForGreen,
	checked = snapshot_at(CHECKED_SHA),
): Promise<void> {
	await git_pr_merge_checked.merge_checked({ branch_name: BRANCH, checked, wait_for_green })
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(git_gh_command.is_head_moved).mockImplementation((failure) => failure === HEAD_MOVED)
	mocked_merge.mockResolvedValue()
})

describe('git_pr_merge_checked.merge_checked', () => {
	it('merges the head of the snapshot the gate already passed, without waiting again', async () => {
		const wait_for_green = vi.fn<WaitForGreen>()

		await merge_checked(wait_for_green)

		expect(mocked_merge).toHaveBeenCalledWith(BRANCH, CHECKED_SHA)
		expect(wait_for_green).not.toHaveBeenCalled()
	})

	it('goes back to waiting when the head moved, then merges the new head once it passes', async () => {
		const wait_for_green = vi.fn<WaitForGreen>().mockResolvedValue(snapshot_at(PUSHED_SHA))

		mocked_merge.mockRejectedValueOnce(HEAD_MOVED)

		await merge_checked(wait_for_green)

		expect(wait_for_green).toHaveBeenCalledTimes(1)
		expect(merged_shas()).toStrictEqual([CHECKED_SHA, PUSHED_SHA])
	})
})

describe('git_pr_merge_checked.merge_checked — a merge that cannot land', () => {
	it('stops rather than chasing a head that keeps moving', async () => {
		const wait_for_green = vi.fn<WaitForGreen>().mockResolvedValue(snapshot_at(PUSHED_SHA))

		mocked_merge.mockRejectedValue(HEAD_MOVED)

		await expect(merge_checked(wait_for_green)).rejects.toThrow(HEAD_KEPT_MOVING_MESSAGE)
		expect(mocked_merge).toHaveBeenCalledTimes(MAX_HEAD_MOVES)
		expect(wait_for_green).toHaveBeenCalledTimes(MAX_HEAD_MOVES)
	})

	it('rethrows any other merge failure unchanged, without waiting again', async () => {
		const wait_for_green = vi.fn<WaitForGreen>()

		mocked_merge.mockRejectedValue(MERGE_REFUSED)

		await expect(merge_checked(wait_for_green)).rejects.toBe(MERGE_REFUSED)
		expect(wait_for_green).not.toHaveBeenCalled()
	})

	it('refuses a snapshot that names no head rather than merging unbound', async () => {
		await expect(merge_checked(vi.fn<WaitForGreen>(), snapshot_at())).rejects.toThrow(
			NO_CHECKED_HEAD_MESSAGE,
		)
		expect(mocked_merge).not.toHaveBeenCalled()
	})
})

describe('git_pr_merge_checked.merge_when_green', () => {
	it('waits on the merge gate first and merges the head it passed', async () => {
		mocked_wait.mockResolvedValue(snapshot_at(CHECKED_SHA))

		await git_pr_merge_checked.merge_when_green(BRANCH)

		expect(mocked_wait).toHaveBeenCalledWith(BRANCH)
		expect(mocked_merge).toHaveBeenCalledWith(BRANCH, CHECKED_SHA)
	})
})
