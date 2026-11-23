import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { split_cap, type SplitCap } from '#scripts/split/split-cap'

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

// An end-to-end target, independent of the internal stage budgets and legacy lane net exclusions. Two
// tiers by actual size (joshuafolkken/kit#8293): a lane within the split guide is judged against 30
// minutes, one past it against 60 — the flat 30 judged nearly every lane past the guide slow.
const TARGET_MINUTES = 30
const OVER_GUIDE_TARGET_MINUTES = 60
const GUIDE: SplitCap = { files: split_cap.FILE_GUIDE, lines: split_cap.LINE_GUIDE }
const INTERNAL_MINUTES = Object.values(BUDGET_MINUTES).reduce((sum, minutes) => sum + minutes, 0)
const DESCRIPTION = `target ${String(TARGET_MINUTES)} min dispatch to merge, ${String(OVER_GUIDE_TARGET_MINUTES)} min past the ${String(GUIDE.files)}-file / ${String(GUIDE.lines)}-line split guide (human wait reported separately, included); internal stage budgets ${String(INTERNAL_MINUTES)} min (plan 3 + implement 9 + ship 8 + followup 5)`

type BudgetStage = keyof typeof BUDGET_MINUTES

// The end-to-end target for a lane's actual size; an unrecorded size keeps the within-guide target.
function target_minutes(actual: SplitCap | undefined): number {
	if (actual === undefined) return TARGET_MINUTES

	return split_cap.is_over(actual.files, actual.lines, GUIDE)
		? OVER_GUIDE_TARGET_MINUTES
		: TARGET_MINUTES
}

// The whole minutes `elapsed_ms` runs past `stage`'s budget, `undefined` within it.
function over_minutes(stage: BudgetStage, elapsed_ms: number): number | undefined {
	const over_ms = elapsed_ms - BUDGET_MINUTES[stage] * MS_PER_MINUTE

	return over_ms > 0 ? Math.ceil(over_ms / MS_PER_MINUTE) : undefined
}

const lane_stage_budget = {
	BUDGET_MINUTES,
	DESCRIPTION,
	OVER_GUIDE_TARGET_MINUTES,
	TARGET_MINUTES,
	over_minutes,
	target_minutes,
}

export { lane_stage_budget }
export type { BudgetStage }
