import { beforeEach, describe, expect, it, vi } from 'vitest'

const uncleared_mock = vi.hoisted(() => vi.fn(() => true))
const plan_paths_mock = vi.hoisted(() => vi.fn(async (): Promise<ReadonlyArray<string>> => []))
const approval_file_mock = vi.hoisted(() =>
	vi.fn(async (): Promise<string | undefined> => undefined),
)

vi.mock('#scripts/lane/lane-plan', () => ({ lane_plan: { is_uncleared: uncleared_mock } }))
vi.mock('#scripts/backlog/backlog-plan-comment', () => ({
	backlog_plan_comment: { plan_paths: plan_paths_mock },
}))
vi.mock('#scripts/backlog/backlog-triage-approval', () => ({
	backlog_triage_approval: { existing_file: approval_file_mock },
}))

const { run_step_lane_plan } = await import('./run-step-lane-plan')
const { lane_plan_auto } = await import('#scripts/lane/lane-plan-auto')

// joshuafolkken/kit#4923: a planned lane child retried a refused Edit before it ran `lane:plan`,
// since nothing it read named that step before the first edit.

const ISSUE = '4910'
const PLANNED = ['scripts/lane/lane-overrun-mechanisms-cli.ts', 'docs/josh-commands-run.md']

beforeEach(() => {
	uncleared_mock.mockReturnValue(true)
	plan_paths_mock.mockResolvedValue([])
	approval_file_mock.mockResolvedValue(undefined)
})

async function command_line(): Promise<string | undefined> {
	const [command] = await run_step_lane_plan.lines_for(ISSUE, true)

	return command
}

describe('run_step_lane_plan.lines_for', () => {
	it('names the plan comment’s paths for a lane child whose plan is not cleared', async () => {
		plan_paths_mock.mockResolvedValue(PLANNED)

		expect(await command_line()).toBe(`pnpm josh lane:plan ${ISSUE} ${PLANNED.join(' ')}`)
	})

	it('quotes a path the shell would read as syntax', async () => {
		plan_paths_mock.mockResolvedValue(['src/routes/(app)/+layout.svelte', 'src/app.css'])

		expect(await command_line()).toBe(
			`pnpm josh lane:plan ${ISSUE} 'src/routes/(app)/+layout.svelte' src/app.css`,
		)
	})

	it('leaves the paths to the child when the issue has no plan comment', async () => {
		expect(await command_line()).toBe(`pnpm josh lane:plan ${ISSUE} <path>...`)
	})

	// joshuafolkken/kit#5934: with `--imports` unnamed, a lane child skipped the import probe of #5928.
	it('follows the command with one line that names --imports', async () => {
		const lines = await run_step_lane_plan.lines_for(ISSUE, true)

		expect(lines).toHaveLength(2)
		expect(lines[1]).toBe(lane_plan_auto.IMPORTS_HINT)
		expect(lines[1]).toContain('--imports <path>...')
	})

	it('names nothing once the plan is cleared', async () => {
		uncleared_mock.mockReturnValue(false)

		expect(await run_step_lane_plan.lines_for(ISSUE, true)).toStrictEqual([])
		expect(plan_paths_mock).not.toHaveBeenCalled()
	})

	it('names nothing outside a lane child', async () => {
		expect(await run_step_lane_plan.lines_for(ISSUE, false)).toStrictEqual([])
		expect(uncleared_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6776: the json `backlog:triage --adopt` wrote reaches the requeued child here.
describe('run_step_lane_plan.lines_for with a size approval', () => {
	it('names the size approval the parent wrote (ac-65c53234)', async () => {
		const file = '/repo/.josh/tmp/size-approval-4910.json'

		plan_paths_mock.mockResolvedValue(PLANNED)
		approval_file_mock.mockResolvedValue(file)

		expect(await command_line()).toBe(
			`pnpm josh lane:plan ${ISSUE} ${PLANNED.join(' ')} --size-approval ${file}`,
		)
		expect(approval_file_mock).toHaveBeenCalledWith(ISSUE)
	})
})
