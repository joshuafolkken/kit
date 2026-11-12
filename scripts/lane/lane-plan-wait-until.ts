import type { LanePlan } from './lane-plan'
import { lane_plan_wait } from './lane-plan-wait'

// The deadline `plan` waits on `holder` until — the one its first wait recorded, else a fresh one —
// or undefined once it passed or the lane does not wait (`lane-plan-wait.ts`). `lane:plan` enforces
// it and `run:review`'s open quotes it (joshuafolkken/kit#6145), so both read it here, apart from
// `lane-plan-check.ts`'s imports.
async function until(plan: LanePlan, holder: number): Promise<string | undefined> {
	const now_ms = Date.now()

	if (plan.waits_until !== undefined) {
		return Date.parse(plan.waits_until) > now_ms ? plan.waits_until : undefined
	}

	const deadline = await lane_plan_wait.deadline(plan.issue, holder, now_ms)

	return deadline === undefined ? undefined : new Date(deadline).toISOString()
}

const lane_plan_wait_until = { until }

export { lane_plan_wait_until }
