import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// Each stage's target within a lane's 25-minute budget (joshuafolkken/kit#5563, joshuafolkken/kit#6540) —
// a goal, not a measure of what a stage usually takes — which `lane:breakdown`, `lane:why` and
// `lane:stats --over` compare a lane's stages against. `run:board` draws a lane's measured finish instead
// (joshuafolkken/kit#7920). Change a budget here only. The ship budget covers preflight to round-2; one
// ship stage is checked against the whole of it, a lower bound of the group's time.

const BUDGET_MINUTES = {
	plan: 3,
	implement: 9,
	ship: 8,
	followup: 5,
} as const

// The lane as a whole is judged by its pace (`lane-pace.ts`, joshuafolkken/kit#9164), not a fixed
// end-to-end target: the stage budgets stay goals for the stages only.
const INTERNAL_MINUTES = Object.values(BUDGET_MINUTES).reduce((sum, minutes) => sum + minutes, 0)
const DESCRIPTION = `internal stage budgets ${String(INTERNAL_MINUTES)} min (plan 3 + implement 9 + ship 8 + followup 5)`

type BudgetStage = keyof typeof BUDGET_MINUTES

// The whole minutes `elapsed_ms` runs past `stage`'s budget, `undefined` within it.
function over_minutes(stage: BudgetStage, elapsed_ms: number): number | undefined {
	const over_ms = elapsed_ms - BUDGET_MINUTES[stage] * MS_PER_MINUTE

	return over_ms > 0 ? Math.ceil(over_ms / MS_PER_MINUTE) : undefined
}

const lane_stage_budget = {
	BUDGET_MINUTES,
	DESCRIPTION,
	over_minutes,
}

export { lane_stage_budget }
export type { BudgetStage }
