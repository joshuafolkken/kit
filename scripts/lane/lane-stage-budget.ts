import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// Each stage's share of a lane's 25-minute budget (joshuafolkken/kit#5563, joshuafolkken/kit#6540), split
// by `lane:stats`'s medians, so `lane:breakdown` and `run:board` say which stage ate the budget while it still runs.
// Change a budget here only. The ship budget covers preflight to round-2; one ship stage is checked against the whole
// of it, a lower bound of the group's time.

const BUDGET_MINUTES = {
	plan: 3,
	implement: 9,
	ship: 8,
	followup: 5,
} as const

// An end-to-end target, independent of the internal stage budgets and legacy lane net exclusions.
const TARGET_MINUTES = 30
const INTERNAL_MINUTES = Object.values(BUDGET_MINUTES).reduce((sum, minutes) => sum + minutes, 0)
const DESCRIPTION = `target ${String(TARGET_MINUTES)} min dispatch to merge (human wait reported separately, included); internal stage budgets ${String(INTERNAL_MINUTES)} min (plan 3 + implement 9 + ship 8 + followup 5)`

type BudgetStage = keyof typeof BUDGET_MINUTES

// The whole minutes `elapsed_ms` runs past `stage`'s budget, `undefined` within it.
function over_minutes(stage: BudgetStage, elapsed_ms: number): number | undefined {
	const over_ms = elapsed_ms - BUDGET_MINUTES[stage] * MS_PER_MINUTE

	return over_ms > 0 ? Math.ceil(over_ms / MS_PER_MINUTE) : undefined
}

const lane_stage_budget = { BUDGET_MINUTES, DESCRIPTION, TARGET_MINUTES, over_minutes }

export { lane_stage_budget }
export type { BudgetStage }
