import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_registered_branch } from './lane-registered-branch'
import { lane_registry } from './lane-registry'

const ISSUE = '8429'
const UNREADABLE = 'registry unreadable'
const find_lane = vi.spyOn(lane_registry, 'find_open_lane')

beforeEach(() => {
	find_lane.mockResolvedValue(undefined)
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

	it('propagates an unreadable registry', async () => {
		find_lane.mockRejectedValue(new Error(UNREADABLE))

		await expect(lane_registered_branch.read(ISSUE)).rejects.toThrow(UNREADABLE)
	})
})
