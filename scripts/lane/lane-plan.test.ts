import path from 'node:path'
import type { Declared } from '#scripts/backlog/backlog-overlap'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan, type LanePlan } from './lane-plan'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#4864: a lane's recorded plan is read as its declaration in place of its body, and a lane
// waits only on a holder that planned before it.

const ROOT = make_directory('lane-plan-')
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
		make_directory(path.join(ROOT, 'repository-')),
	)
})

describe('lane_plan.with_plans', () => {
	// joshuafolkken/kit#4937: a path the body only cites holds nothing once the lane recorded its plan.
	it('reads a recorded plan in place of the paths the body declares', () => {
		lane_plan.record(EARLIER_PLAN, DIRECTORY)

		const replaced = lane_plan.with_plans(new Map([[EARLIER, new Set([RANK])]]), DIRECTORY)

		expect([...(replaced.get(EARLIER) ?? [])]).toEqual([OVERRUN])
	})

	it('leaves an issue with no recorded plan at its body', () => {
		const joined = lane_plan.with_plans(new Map([[UNPLANNED, new Set([RANK])]]), DIRECTORY)

		expect([...(joined.get(UNPLANNED) ?? [])]).toEqual([RANK])
	})
})

const HOUR_MS = 3_600_000

// The paths read for the earlier issue, yielded on its recorded plan, whose plan comment declaring
// `RANK` was posted `at`.
function commented_at(at: string): Array<string> {
	lane_plan.record({ ...EARLIER_PLAN, yielded: true }, DIRECTORY)

	const declared = lane_plan.with_plans(
		new Map([[EARLIER, new Set([RANK])]]),
		DIRECTORY,
		new Map([[EARLIER, at]]),
	)

	return [...(declared.get(EARLIER) ?? [])]
}

// joshuafolkken/kit#6798: joshuafolkken/kit#6796 fixed its plan comment after yielding, and every
// redispatch yielded again on the kept plan.
describe('lane_plan.with_plans with plan comment times', () => {
	it('reads a plan comment posted after the recorded plan in place of it', () => {
		const later = new Date(Date.now() + HOUR_MS).toISOString()

		expect(commented_at(later)).toEqual([RANK])
	})

	it('keeps the recorded plan over a plan comment posted before it', () => {
		expect(commented_at('2000-01-01T00:00:00Z')).toEqual([OVERRUN])
	})

	it('keeps the recorded plan over an undated plan comment', () => {
		expect(commented_at('(undated)')).toEqual([OVERRUN])
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

	// joshuafolkken/kit#4926: a yielded lane keeps its earlier place in line, which must not take a file
	// from a lane that cleared after it and may be editing it.
	it('names a cleared holder even when it planned after this one', () => {
		lane_plan.record({ ...LATER_PLAN, cleared: true }, DIRECTORY)

		expect(lane_plan.earlier_holders(EARLIER_PLAN, [LATER], DIRECTORY)).toEqual([LATER])
	})

	it('reads an issue as uncleared until its plan is recorded cleared', () => {
		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(true)

		lane_plan.record(LATER_PLAN, DIRECTORY)

		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(true)

		lane_plan.record({ ...LATER_PLAN, cleared: true }, DIRECTORY)

		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(false)
	})

	it('reads back the plan it recorded', () => {
		lane_plan.record(LATER_PLAN, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)).toEqual(LATER_PLAN)
	})

	it('forgets a plan once it is removed', () => {
		lane_plan.record(LATER_PLAN, DIRECTORY)
		lane_plan.remove(LATER, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)).toBeUndefined()
	})
})

// joshuafolkken/kit#5672: a narrowing re-plan keeps the files an earlier clear held, for the hunks axis.
describe('lane_plan.record on a re-plan', () => {
	it('keeps every path an earlier cleared plan held when a re-plan narrows it', () => {
		lane_plan.record({ ...LATER_PLAN, paths: [OVERRUN, RANK], cleared: true }, DIRECTORY)
		lane_plan.record(LATER_PLAN, DIRECTORY)
		lane_plan.record({ ...LATER_PLAN, cleared: true }, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)?.cleared_paths).toEqual([OVERRUN, RANK])
	})

	it('records no history before any plan of the issue cleared', () => {
		lane_plan.record(LATER_PLAN, DIRECTORY)
		lane_plan.record(LATER_PLAN, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)?.cleared_paths).toBeUndefined()
	})
})

describe('lane_plan.release', () => {
	// joshuafolkken/kit#4926: a lane that yielded closes on a plan marked yielded, which keeps the issue
	// held back and its place in line; any other plan — cleared or never answered — leaves nothing.
	it('releases a cleared plan with its lane and keeps one the lane yielded on', () => {
		const yielded = { ...LATER_PLAN, yielded: true }

		lane_plan.record({ ...EARLIER_PLAN, cleared: true }, DIRECTORY)
		lane_plan.record(yielded, DIRECTORY)
		lane_plan.release(EARLIER, DIRECTORY)
		lane_plan.release(LATER, DIRECTORY)

		expect(lane_plan.read(EARLIER, DIRECTORY)).toBeUndefined()
		expect(lane_plan.read(LATER, DIRECTORY)).toEqual(yielded)
	})

	it('releases an uncleared plan its lane did not yield on', () => {
		lane_plan.record(LATER_PLAN, DIRECTORY)
		lane_plan.release(LATER, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)).toBeUndefined()
	})
})

// The earlier lane in flight, its body declaring `body` and its recorded plan read in its place.
function in_flight(...body: ReadonlyArray<string>): Declared {
	return lane_plan.with_plans(new Map([[EARLIER, new Set(body)]]), DIRECTORY)
}

describe('lane_plan.is_yield_held', () => {
	// joshuafolkken/kit#4926: a named run holds a yielded issue back on its kept plan while an earlier
	// lane in flight still plans one of its files.
	it('holds a yielded plan while an earlier lane in flight plans one of its files', () => {
		lane_plan.record(EARLIER_PLAN, DIRECTORY)
		lane_plan.record({ ...LATER_PLAN, yielded: true }, DIRECTORY)

		expect(lane_plan.is_yield_held(LATER, in_flight(), DIRECTORY)).toBe(true)
		expect(lane_plan.is_yield_held(LATER, new Map(), DIRECTORY)).toBe(false)
	})

	// joshuafolkken/kit#4937: the holder's recorded plan is its whole scope, so a file its body only
	// cites holds nothing.
	it('holds no yielded plan on a file an earlier lane in flight only cites in its body', () => {
		lane_plan.record({ ...EARLIER_PLAN, paths: [RANK] }, DIRECTORY)
		lane_plan.record({ ...LATER_PLAN, yielded: true }, DIRECTORY)

		expect(lane_plan.is_yield_held(LATER, in_flight(OVERRUN), DIRECTORY)).toBe(false)
	})

	// joshuafolkken/kit#6798: a plan comment fixed since the yield is the scope held, not the kept paths.
	it('holds a yielded issue on the scope it is handed in place of its kept paths', () => {
		lane_plan.record(EARLIER_PLAN, DIRECTORY)
		lane_plan.record({ ...LATER_PLAN, yielded: true }, DIRECTORY)

		expect(lane_plan.is_yield_held(LATER, in_flight(), DIRECTORY, new Set([RANK]))).toBe(false)
	})

	it('holds no plan its lane did not yield on', () => {
		lane_plan.record(EARLIER_PLAN, DIRECTORY)
		lane_plan.record(LATER_PLAN, DIRECTORY)

		expect(lane_plan.is_yield_held(LATER, in_flight(), DIRECTORY)).toBe(false)
	})

	it('holds no yielded plan that no lane in flight overlaps', () => {
		lane_plan.record({ ...EARLIER_PLAN, paths: [RANK] }, DIRECTORY)
		lane_plan.record({ ...LATER_PLAN, yielded: true }, DIRECTORY)

		expect(lane_plan.is_yield_held(LATER, in_flight(), DIRECTORY)).toBe(false)
	})
})
