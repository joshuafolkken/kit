import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_lane_handover } from './review-lane-handover'

// joshuafolkken/kit#4850: a lane child reopened `run:review` after recording round 1, running a round 2
// the ship ran again. The handover is decided here, from the mark and the ship's own reuse predicate,
// which already requires the recorded round.

const { reusable_mock } = vi.hoisted(() => ({ reusable_mock: vi.fn() }))

vi.mock('./review-round-reuse', () => ({
	review_round_reuse: { is_reusable_here: reusable_mock },
}))

const ISSUE = 4850
const OTHER_ISSUE = 4775
const SHIP_STEP = 'pnpm josh ship --detach --review'

function mark(issue: string | undefined, is_child: boolean): void {
	vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(issue)
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(is_child)
}

beforeEach(() => {
	reusable_mock.mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	reusable_mock.mockReset()
})

describe('review_lane_handover.is_handed_over — the recorded round', () => {
	it('hands over a lane child whose round 1 the ship reuses', async () => {
		mark(String(ISSUE), true)

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(true)
		expect(reusable_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('keeps run:review open when no round is recorded, or the ship would review it again', async () => {
		mark(String(ISSUE), true)
		reusable_mock.mockResolvedValue(false)

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
	})

	it('keeps run:review open when git cannot answer the reuse question', async () => {
		mark(String(ISSUE), true)
		reusable_mock.mockRejectedValue(new Error('git unavailable'))

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
	})
})

describe('review_lane_handover.is_handed_over — the lane mark', () => {
	it('never refuses outside a lane child, without asking the reuse question', async () => {
		mark(undefined, false)

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
		expect(reusable_mock).not.toHaveBeenCalled()
	})

	it('never refuses a mark that names another issue than the branch', async () => {
		mark(String(OTHER_ISSUE), true)

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
	})

	it('never refuses a mark that leaked into a checkout it does not belong to', async () => {
		mark(String(ISSUE), false)

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
	})
})

describe('review_lane_handover text', () => {
	it('points the refusal at the ship and names the issue', () => {
		const text = review_lane_handover.refusal(ISSUE)

		expect(text).toContain(String(ISSUE))
		expect(text).toContain(SHIP_STEP)
	})

	it('names the ship as the next step', () => {
		expect(review_lane_handover.NEXT_STEP_LINE).toContain(SHIP_STEP)
	})
})
