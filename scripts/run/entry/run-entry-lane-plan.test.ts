import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { is_child_mock, is_uncleared_mock, read_plan_mock, run_mock } = vi.hoisted(() => ({
	is_child_mock: vi.fn(() => true),
	is_uncleared_mock: vi.fn(() => true),
	read_plan_mock: vi.fn(async (): Promise<string | undefined> => undefined),
	run_mock: vi.fn(async () => 0),
}))

vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/lane/lane-plan', () => ({ lane_plan: { is_uncleared: is_uncleared_mock } }))
vi.mock('#scripts/backlog/backlog-plan-comment', () => ({
	backlog_plan_comment: { read_plan: read_plan_mock },
}))
vi.mock(import('#scripts/lane/lane-plan-auto'), async (import_original) => {
	const { lane_plan_auto } = await import_original()

	return { lane_plan_auto: { ...lane_plan_auto, run_from_plan: run_mock } }
})

const { run_entry_lane_plan } = await import('./run-entry-lane-plan')

// joshuafolkken/kit#5741: a lane child entering a kickoff-planned issue runs `lane:plan` on its plan
// comment's paths at the entry; a plan naming none runs nothing, leaving `run:step`'s line.

const ISSUE = '5741'
const PLANNED = 'planned'
const EDITED = 'scripts/run/entry/run-entry-lane-plan.ts'
const YIELD_EXIT_CODE = 2
const PLAN = `## 計画\n\n- \`${EDITED}\` を追加する\n`
const PATHLESS_PLAN = `## 計画\n\n- 入口で実行する\n\n${plan_consumers_section.HEADING}\n\n- なし\n`

beforeEach(() => {
	vi.clearAllMocks()
	read_plan_mock.mockResolvedValue(PLAN)
})

describe('run_entry_lane_plan.run_at_entry', () => {
	it('runs lane:plan on the plan comment and returns its code', async () => {
		run_mock.mockResolvedValueOnce(YIELD_EXIT_CODE)

		expect(await run_entry_lane_plan.run_at_entry(ISSUE, PLANNED)).toBe(YIELD_EXIT_CODE)
		expect(run_mock).toHaveBeenCalledExactlyOnceWith(ISSUE, PLAN)
		expect(read_plan_mock).toHaveBeenCalledExactlyOnceWith(Number(ISSUE))
	})

	it('runs nothing for an issue that is not planned', async () => {
		expect(await run_entry_lane_plan.run_at_entry(ISSUE, 'fresh')).toBeUndefined()
		expect(read_plan_mock).not.toHaveBeenCalled()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs nothing outside a lane child', async () => {
		is_child_mock.mockReturnValueOnce(false)

		expect(await run_entry_lane_plan.run_at_entry(ISSUE, PLANNED)).toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs nothing once the lane plan has cleared', async () => {
		is_uncleared_mock.mockReturnValueOnce(false)

		expect(await run_entry_lane_plan.run_at_entry(ISSUE, PLANNED)).toBeUndefined()
		expect(read_plan_mock).not.toHaveBeenCalled()
	})

	it('runs nothing when no plan comment is read', async () => {
		read_plan_mock.mockResolvedValueOnce(undefined)

		expect(await run_entry_lane_plan.run_at_entry(ISSUE, PLANNED)).toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs nothing when the plan comment names no path', async () => {
		read_plan_mock.mockResolvedValueOnce(PATHLESS_PLAN)

		expect(await run_entry_lane_plan.run_at_entry(ISSUE, PLANNED)).toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})
})
