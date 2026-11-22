import { git_gh_issue_merged_pull } from '#scripts/gh/git-gh-issue-merged-pull'
import { git_gh_pr_auto_merge } from '#scripts/gh/git-gh-pr-auto-merge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_registered_branch } from './lane-registered-branch'
import { lane_registry } from './lane-registry'

const ISSUE = '8429'
const UNREADABLE = 'registry unreadable'
const find_lane = vi.spyOn(lane_registry, 'find_open_lane')
const open_pulls = vi.spyOn(git_gh_pr_auto_merge, 'pr_list_open_with_head_prefix')
const merged_head = vi.spyOn(git_gh_issue_merged_pull, 'pr_merged_head_of_issue')

beforeEach(() => {
	find_lane.mockResolvedValue(undefined)
	open_pulls.mockResolvedValue([])
	merged_head.mockResolvedValue(undefined)
})

describe('lane_registered_branch.read', () => {
	it('uses the registered PR head (ac-8429)', async () => {
		const slug = `${ISSUE}-legacy-implementation`

		find_lane.mockResolvedValue(
			lane_registry.parse_block(`worktree /lanes/${ISSUE}\nbranch refs/heads/${slug}`, '/lanes'),
		)

		await expect(lane_registered_branch.read(ISSUE)).resolves.toBe(slug)
		expect(find_lane).toHaveBeenCalledWith(ISSUE)
	})

	it('keeps the default name when no lane is registered', async () => {
		await expect(lane_registered_branch.read(ISSUE)).resolves.toBe(`${ISSUE}-lane`)
	})
})

describe('lane_registered_branch.read after lane close', () => {
	it('recovers the open PR head after the lane registration is removed (ac-8429)', async () => {
		const slug = `${ISSUE}-legacy-implementation`

		open_pulls.mockResolvedValue([{ number: 1, head_ref: slug, has_auto_merge: false }])
		merged_head.mockResolvedValue(`${ISSUE}-older-implementation`)

		await expect(lane_registered_branch.read(ISSUE)).resolves.toBe(slug)
		expect(open_pulls).toHaveBeenCalledWith(`${ISSUE}-`)
		expect(merged_head).not.toHaveBeenCalled()
	})

	it('recovers the merged PR head after its lane and branch are gone (ac-8429)', async () => {
		const slug = `${ISSUE}-legacy-implementation`

		merged_head.mockResolvedValue(slug)

		await expect(lane_registered_branch.read(ISSUE)).resolves.toBe(slug)
		expect(merged_head).toHaveBeenCalledWith(ISSUE)
	})

	it('refuses ambiguous open PR heads after the lane is closed (ac-8429)', async () => {
		open_pulls.mockResolvedValue([
			{ number: 1, head_ref: `${ISSUE}-first`, has_auto_merge: false },
			{ number: 2, head_ref: `${ISSUE}-second`, has_auto_merge: false },
		])

		await expect(lane_registered_branch.read(ISSUE)).rejects.toThrow('Multiple open pull requests')
	})

	it('propagates an unreadable PR listing instead of inventing a branch (ac-8429)', async () => {
		open_pulls.mockRejectedValue(new Error(UNREADABLE))

		await expect(lane_registered_branch.read(ISSUE)).rejects.toThrow(UNREADABLE)
		expect(merged_head).not.toHaveBeenCalled()
	})
})

describe('lane_registered_branch.read failures', () => {
	it('propagates an unreadable registry', async () => {
		find_lane.mockRejectedValue(new Error(UNREADABLE))

		await expect(lane_registered_branch.read(ISSUE)).rejects.toThrow(UNREADABLE)
	})
})
