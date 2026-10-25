import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_lane_handover } from './review-lane-handover'

// joshuafolkken/kit#4850: a lane child reopened `run:review` after recording round 1, running a round 2
// the ship ran again. The handover is decided here, from the mark and the ship's own reuse predicate,
// which already requires the recorded round.

const { reusable_mock } = vi.hoisted(() => ({ reusable_mock: vi.fn() }))

vi.mock('./review-round-reuse', () => ({
	review_round_reuse: {
		REUSE: { AGAIN: 'again', DELTA: 'delta', HELD: 'held' },
		answer_here: reusable_mock,
	},
}))

const ISSUE = 4850
const OTHER_ISSUE = 4775
const SHIP_STEP = 'pnpm josh ship --detach --review'
const DELTA = 'delta'
const GIT_FAILURE = 'git unavailable'

function mark(issue: string | undefined, is_child: boolean): void {
	vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(issue)
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(is_child)
}

beforeEach(() => {
	reusable_mock.mockResolvedValue({ reuse: 'held' })
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
		reusable_mock.mockResolvedValue({ reuse: 'again' })

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
	})

	// joshuafolkken/kit#4878: the moved files are round 2's, so the lane hands over all the same.
	it('hands over a lane child whose recorded round the ship reuses with a delta', async () => {
		mark(String(ISSUE), true)
		reusable_mock.mockResolvedValue({ reuse: DELTA })

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(true)
	})

	it('keeps run:review open when git cannot answer the reuse question', async () => {
		mark(String(ISSUE), true)
		reusable_mock.mockRejectedValue(new Error(GIT_FAILURE))

		expect(await review_lane_handover.is_handed_over(ISSUE)).toBe(false)
	})
})

describe('review_lane_handover.answer_here — the reuse answer', () => {
	it("passes the ship's three-way answer through", async () => {
		reusable_mock.mockResolvedValue({ reuse: DELTA })

		expect(await review_lane_handover.answer_here(ISSUE)).toStrictEqual({ reuse: DELTA })
	})

	it('answers again and traces the failure when git cannot answer', async () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)
		const error = new Error(GIT_FAILURE)

		reusable_mock.mockRejectedValue(error)

		expect(await review_lane_handover.answer_here(ISSUE)).toStrictEqual({
			reuse: 'again',
			cause: 'git could not answer the reuse question',
		})
		expect(trace).toHaveBeenCalledWith('review_lane_handover.answer_here', error)
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
