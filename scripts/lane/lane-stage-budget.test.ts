import { describe, expect, it } from 'vitest'
import { lane_stage_budget } from './lane-stage-budget'

// joshuafolkken/kit#5563: a 30-minute lane's budget split by stage, and the whole minutes past it.

const MINUTE_MS = 60_000

describe('lane_stage_budget.BUDGET_MINUTES', () => {
	it('splits 30 minutes into plan 3, implement 12, ship 10 and followup 5', () => {
		expect(lane_stage_budget.BUDGET_MINUTES).toStrictEqual({
			plan: 3,
			implement: 12,
			ship: 10,
			followup: 5,
		})
	})
})

describe('lane_stage_budget.over_minutes', () => {
	it('is undefined up to the budget and the whole minutes past it, rounded up', () => {
		expect(lane_stage_budget.over_minutes('implement', 12 * MINUTE_MS)).toBeUndefined()
		expect(lane_stage_budget.over_minutes('implement', 12 * MINUTE_MS + 1)).toBe(1)
		expect(lane_stage_budget.over_minutes('implement', 20 * MINUTE_MS)).toBe(8)
	})
})
