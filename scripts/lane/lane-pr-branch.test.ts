import { git_gh_pr_auto_merge, type OpenPull } from '#scripts/gh/git-gh-pr-auto-merge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_pr_branch } from './lane-pr-branch'
import type { LaneInfo } from './lane-registry'
import { lane_start_point } from './lane-start-point'

const ISSUE = '5272'
const LEGACY_BRANCH = '5272-upgrade-typescript-to-7-and-fix-forward'
const LANE_BRANCH = '5272-lane'
const PR_NUMBER = 7498
const START_POINT = 'refs/remotes/origin/main'
const READ_FAILURE = 'rate limited'

function pull(head_reference: string): OpenPull {
	return { number: PR_NUMBER, head_ref: head_reference, has_auto_merge: false }
}

function existing_lane(branch: string): LaneInfo {
	return {
		issue: ISSUE,
		branch,
		directory: `/lanes/${ISSUE}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

beforeEach(() => {
	vi.spyOn(git_gh_pr_auto_merge, 'pr_list_open_with_head_prefix').mockResolvedValue([])
	vi.spyOn(lane_start_point, 'resolve_for_branch').mockResolvedValue(START_POINT)
})

describe('an already-open PR lane', () => {
	it('retains an already-open lane on the PR head without resolving another start point', async () => {
		vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockResolvedValue([
			pull(LEGACY_BRANCH),
		])

		expect(await lane_pr_branch.resolve(ISSUE, existing_lane(LEGACY_BRANCH))).toEqual({
			branch: LEGACY_BRANCH,
			start_point: undefined,
		})
		expect(lane_start_point.resolve_for_branch).not.toHaveBeenCalled()
	})
})

describe('the PR head a lane resumes', () => {
	it('opens the canonical branch for a new issue (ac-a64f0b40)', async () => {
		expect(await lane_pr_branch.resolve(ISSUE)).toEqual({
			branch: LANE_BRANCH,
			start_point: START_POINT,
		})
		expect(lane_start_point.resolve_for_branch).toHaveBeenCalledWith(LANE_BRANCH, false)
	})

	it.each([LEGACY_BRANCH, LANE_BRANCH])(
		'keeps the existing PR on %s (ac-0009c1ae)',
		async (branch) => {
			vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockResolvedValue([
				pull(branch),
			])

			const selected = await lane_pr_branch.resolve(ISSUE)

			expect(selected.branch).toBe(branch)
			expect(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).toHaveBeenCalledWith(`${ISSUE}-`)
			expect(lane_start_point.resolve_for_branch).toHaveBeenCalledWith(branch, true)
		},
	)
})

describe('unsafe PR resolution', () => {
	it('refuses multiple candidates before choosing a start point (ac-a64f0b40)', async () => {
		vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockResolvedValue([
			pull(LEGACY_BRANCH),
			pull(LANE_BRANCH),
		])

		await expect(lane_pr_branch.resolve(ISSUE)).rejects.toThrow('Multiple open pull requests')
		expect(lane_start_point.resolve_for_branch).not.toHaveBeenCalled()
	})

	it('propagates a failed PR read before choosing a start point (ac-a64f0b40)', async () => {
		vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockRejectedValue(
			new Error(READ_FAILURE),
		)

		await expect(lane_pr_branch.resolve(ISSUE)).rejects.toThrow(READ_FAILURE)
		expect(lane_start_point.resolve_for_branch).not.toHaveBeenCalled()
	})

	it('refuses an already-open lane on a different branch with a reopen path (ac-0009c1ae)', async () => {
		vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockResolvedValue([
			pull(LEGACY_BRANCH),
		])

		await expect(lane_pr_branch.resolve(ISSUE, existing_lane(LANE_BRANCH))).rejects.toThrow(
			`pnpm josh lane:close ${ISSUE}`,
		)
		expect(lane_start_point.resolve_for_branch).not.toHaveBeenCalled()
	})

	it('retains an already-open adopted lane when the PR has disappeared', async () => {
		expect(await lane_pr_branch.resolve(ISSUE, existing_lane(LEGACY_BRANCH))).toEqual({
			branch: LEGACY_BRANCH,
			start_point: undefined,
		})
		expect(lane_start_point.resolve_for_branch).not.toHaveBeenCalled()
	})
})
