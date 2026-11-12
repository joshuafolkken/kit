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

describe('lane_stage_budget.over_minutes', () => {
	it('is undefined up to the budget and the whole minutes past it, rounded up', () => {
		expect(lane_stage_budget.over_minutes('implement', 9 * MINUTE_MS)).toBeUndefined()
		expect(lane_stage_budget.over_minutes('implement', 9 * MINUTE_MS + 1)).toBe(1)
		expect(lane_stage_budget.over_minutes('implement', 20 * MINUTE_MS)).toBe(11)
	})
})
