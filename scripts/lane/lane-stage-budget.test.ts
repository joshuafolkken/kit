import { split_cap } from '#scripts/split/split-cap'
import { describe, expect, it } from 'vitest'
import { lane_stage_budget } from './lane-stage-budget'

// joshuafolkken/kit#5563, joshuafolkken/kit#6540: a lane's 25-minute budget split by stage, and the
// whole minutes past it.

const MINUTE_MS = 60_000

describe('lane_stage_budget.BUDGET_MINUTES', () => {
	it('splits 25 minutes into plan 3, implement 9, ship 8 and followup 5', () => {
		expect(lane_stage_budget.BUDGET_MINUTES).toStrictEqual({
			plan: 3,
			implement: 9,
			ship: 8,
			followup: 5,
		})
	})

	it('distinguishes the inclusive end-to-end target from the unchanged internal budgets', () => {
		expect(lane_stage_budget.TARGET_MINUTES).toBe(30)
		expect(lane_stage_budget.DESCRIPTION).toContain('human wait reported separately, included')
		expect(lane_stage_budget.DESCRIPTION).toContain('internal stage budgets 25 min')
	})
})

describe('lane_stage_budget.target_minutes (#8729)', () => {
	const { OVER_GUIDE_TARGET_MINUTES, TARGET_MINUTES, target_minutes } = lane_stage_budget

	it('keeps 30 minutes for an unrecorded size and a size within the split guide', () => {
		expect(target_minutes(undefined)).toBe(TARGET_MINUTES)
		expect(target_minutes({ files: 3, lines: 120 })).toBe(30)
	})

	it('keeps 30 minutes at exactly the split guide, which is still within it', () => {
		expect(target_minutes({ files: split_cap.FILE_GUIDE, lines: split_cap.LINE_GUIDE })).toBe(30)
	})

	it('raises to 60 minutes once either axis is past the split guide', () => {
		expect(target_minutes({ files: split_cap.FILE_GUIDE + 1, lines: 10 })).toBe(60)
		expect(target_minutes({ files: 1, lines: split_cap.LINE_GUIDE + 1 })).toBe(
			OVER_GUIDE_TARGET_MINUTES,
		)
	})

	it('names both tiers and the guide in the description', () => {
		expect(lane_stage_budget.DESCRIPTION).toContain('target 30 min dispatch to merge')
		expect(lane_stage_budget.DESCRIPTION).toContain('60 min past the 8-file / 200-line split guide')
	})
})

describe('lane_stage_budget.over_minutes', () => {
	it('is undefined up to the budget and the whole minutes past it, rounded up', () => {
		expect(lane_stage_budget.over_minutes('implement', 9 * MINUTE_MS)).toBeUndefined()
		expect(lane_stage_budget.over_minutes('implement', 9 * MINUTE_MS + 1)).toBe(1)
		expect(lane_stage_budget.over_minutes('implement', 20 * MINUTE_MS)).toBe(11)
	})
})
