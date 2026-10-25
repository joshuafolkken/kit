import { beforeEach, describe, expect, it, vi } from 'vitest'

const uncleared_mock = vi.hoisted(() => vi.fn(() => true))
const plan_paths_mock = vi.hoisted(() => vi.fn(async (): Promise<ReadonlyArray<string>> => []))

vi.mock('#scripts/lane/lane-plan', () => ({ lane_plan: { is_uncleared: uncleared_mock } }))
vi.mock('#scripts/backlog/backlog-plan-comment', () => ({
	backlog_plan_comment: { plan_paths: plan_paths_mock },
}))

const { run_step_lane_plan } = await import('./run-step-lane-plan')

// joshuafolkken/kit#4923: a planned lane child retried a refused Edit before it ran `lane:plan`,
// since nothing it read named that step before the first edit.

const ISSUE = '4910'
const PLANNED = ['scripts/lane/lane-overrun-mechanisms-cli.ts', 'docs/josh-commands-run.md']

beforeEach(() => {
	vi.clearAllMocks()
	uncleared_mock.mockReturnValue(true)
	plan_paths_mock.mockResolvedValue([])
})

describe('run_step_lane_plan.line_for', () => {
	it('names the plan comment’s paths for a lane child whose plan is not cleared', async () => {
		plan_paths_mock.mockResolvedValue(PLANNED)

		expect(await run_step_lane_plan.line_for(ISSUE, true)).toBe(
			`pnpm josh lane:plan ${ISSUE} ${PLANNED.join(' ')}`,
		)
	})

	it('quotes a path the shell would read as syntax', async () => {
		plan_paths_mock.mockResolvedValue(['src/routes/(app)/+layout.svelte', 'src/app.css'])

		expect(await run_step_lane_plan.line_for(ISSUE, true)).toBe(
			`pnpm josh lane:plan ${ISSUE} 'src/routes/(app)/+layout.svelte' src/app.css`,
		)
	})

	it('leaves the paths to the child when the issue has no plan comment', async () => {
		expect(await run_step_lane_plan.line_for(ISSUE, true)).toBe(
			`pnpm josh lane:plan ${ISSUE} <path>...`,
		)
	})

	it('names nothing once the plan is cleared', async () => {
		uncleared_mock.mockReturnValue(false)

		expect(await run_step_lane_plan.line_for(ISSUE, true)).toBeUndefined()
		expect(plan_paths_mock).not.toHaveBeenCalled()
	})

	it('names nothing outside a lane child', async () => {
		expect(await run_step_lane_plan.line_for(ISSUE, false)).toBeUndefined()
		expect(uncleared_mock).not.toHaveBeenCalled()
	})
})
