import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan, type LanePlan } from './lane-plan'

// joshuafolkken/kit#4864: a lane's recorded plan is read as a declaration beside its body, and a lane
// waits only on a holder that planned before it.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-'))
const DIRECTORY = path.join(ROOT, 'lane')
const EARLIER = 4858
const LATER = 4859
const UNPLANNED = 4857
const OVERRUN = 'scripts/lane/lane-overrun.ts'
const RANK = 'scripts/backlog/backlog-rank.ts'

function plan(issue: number, planned_at: string): LanePlan {
	return { issue, paths: [OVERRUN], planned_at }
}

const EARLIER_PLAN = plan(EARLIER, '2026-10-25T03:10:00.000Z')
const LATER_PLAN = plan(LATER, '2026-10-25T03:20:00.000Z')

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('lane_plan.with_plans', () => {
	it('joins a recorded plan to the paths the body declares', () => {
		lane_plan.record(EARLIER_PLAN, DIRECTORY)

		const joined = lane_plan.with_plans(new Map([[EARLIER, new Set([RANK])]]), DIRECTORY)

		expect([...(joined.get(EARLIER) ?? [])]).toEqual([RANK, OVERRUN])
	})

	it('leaves an issue with no recorded plan at its body', () => {
		const joined = lane_plan.with_plans(new Map([[UNPLANNED, new Set([RANK])]]), DIRECTORY)

		expect([...(joined.get(UNPLANNED) ?? [])]).toEqual([RANK])
	})
})

describe('lane_plan.earlier_holders', () => {
	it('names only the holders that recorded a plan before this one', () => {
		lane_plan.record(EARLIER_PLAN, DIRECTORY)
		lane_plan.record(LATER_PLAN, DIRECTORY)

		const holders = [EARLIER, LATER, UNPLANNED]

		expect(lane_plan.earlier_holders(LATER_PLAN, holders, DIRECTORY)).toEqual([EARLIER])
		expect(lane_plan.earlier_holders(EARLIER_PLAN, holders, DIRECTORY)).toEqual([])
	})

	it('reads an issue as uncleared until its plan is recorded cleared', () => {
		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(true)

		lane_plan.record(LATER_PLAN, DIRECTORY)

		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(true)

		lane_plan.record({ ...LATER_PLAN, cleared: true }, DIRECTORY)

		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(false)
	})

	it('forgets a plan once it is removed', () => {
		lane_plan.record(LATER_PLAN, DIRECTORY)
		lane_plan.remove(LATER, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)).toBeUndefined()
	})

	it('reads back the plan it recorded', () => {
		lane_plan.record(LATER_PLAN, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)).toEqual(LATER_PLAN)
	})
})
