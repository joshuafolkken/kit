import { describe, expect, it, vi } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_wait } from './lane-plan-wait'
import { lane_plan_wait_until } from './lane-plan-wait-until'

// joshuafolkken/kit#6145: `lane:plan` and `run:review`'s open read the one deadline a lane waits on.

const ISSUE = 6035
const HOLDER = 6036
const AHEAD_MS = 600_000
const deadline = vi.spyOn(lane_plan_wait, 'deadline')

function plan_of(waits_until?: string): LanePlan {
	const plan = { issue: ISSUE, paths: ['scripts/a.ts'], planned_at: '2026-11-02T00:00:00.000Z' }

	return waits_until === undefined ? plan : { ...plan, waits_until }
}

describe('lane_plan_wait_until.until', () => {
	it('keeps a recorded deadline still ahead, asking for no new one', async () => {
		const ahead = new Date(Date.now() + AHEAD_MS).toISOString()

		expect(await lane_plan_wait_until.until(plan_of(ahead), HOLDER)).toBe(ahead)
		expect(deadline).not.toHaveBeenCalled()
	})

	it('answers none once the recorded deadline passed', async () => {
		expect(
			await lane_plan_wait_until.until(plan_of('2026-01-01T00:00:00.000Z'), HOLDER),
		).toBeUndefined()
	})

	it('asks for a fresh deadline when none is recorded', async () => {
		const until_ms = Date.now() + AHEAD_MS

		deadline.mockResolvedValueOnce(until_ms)

		expect(await lane_plan_wait_until.until(plan_of(), HOLDER)).toBe(
			new Date(until_ms).toISOString(),
		)
		expect(deadline).toHaveBeenCalledWith(ISSUE, HOLDER, expect.any(Number))
	})

	it('answers none when the lane does not wait', async () => {
		deadline.mockResolvedValueOnce(undefined)

		expect(await lane_plan_wait_until.until(plan_of(), HOLDER)).toBeUndefined()
	})
})
