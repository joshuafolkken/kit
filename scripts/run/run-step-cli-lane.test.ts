import type { IssueState } from '#scripts/issue/issue-state'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrepParts } from './run-prep'
import { run_step } from './run-step'

// `run:step` as a lane child reads it — the position a lane's own stream gives, and the `lane:plan`
// command a planned child runs before its first edit (joshuafolkken/kit#4923).

const ISSUE = '4910'
const RUN_START = '2026-10-25T14:42:26.000Z'
const lane_child_mock = vi.hoisted(() => vi.fn(() => true))
const lane_plan_line_mock = vi.hoisted(() => vi.fn())
const to_parts_mock = vi.hoisted(() => vi.fn())
const read_carry_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { parse_number: () => ISSUE, gather: async () => ({}), to_parts: to_parts_mock },
}))

vi.mock('#scripts/run/carry/run-carry', () => ({
	run_carry: {
		repository_directory: async () => '/repo',
		read_carry: read_carry_mock,
		carry_path: (directory: string) => `${directory}/carry`,
		retrospective_done_of: () => false,
		is_at_cut_cap: () => false,
	},
}))

vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { own_ancestry: () => new Set() } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: lane_child_mock, marked_issue: () => undefined },
}))
vi.mock('./run-step-lane-plan', () => ({
	run_step_lane_plan: { line_for: lane_plan_line_mock },
}))

const { run_step_cli } = await import('./run-step-cli')

const OPEN_STATE: IssueState = { state: 'OPEN', labels: [], is_human_review: false }
const PARTS: PrepParts = {
	issue_number: ISSUE,
	content_body: 'body',
	state: OPEN_STATE,
	state_failure: '',
	latest_scope: 'skip',
	latest_reason: 'window is 12h',
	has_changes: false,
	locations: '',
	ship_problems: [],
}
const LANE_PLAN_LINE = `pnpm josh lane:plan ${ISSUE} scripts/lane/lane-overrun-mechanisms-cli.ts`
const info_mock = vi.fn()

function stream(events: ReadonlyArray<RunEvent>): void {
	vi.spyOn(run_event_stream, 'read_events').mockReturnValue([...events])
}

function printed_lines(): Array<string> {
	return info_mock.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.stubEnv('JOSH_RUN_HEADLESS', '')
	lane_child_mock.mockReturnValue(true)
	to_parts_mock.mockReturnValue(PARTS)
	read_carry_mock.mockReturnValue({ kind: 'carried', carry: { started_at: RUN_START } })
	lane_plan_line_mock.mockResolvedValue(undefined)
	stream([])
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	info_mock.mockReset()
})

describe('run_step_cli.run — a lane child', () => {
	// joshuafolkken/kit#3039: another lane's merge under the batch's carry scope was read as a planned lane
	// child's position, so `run:step` told it to stop while `run:entry` / `run:next` said implement.
	it('answers implement to a lane child whose stream ends in another issue’s merge', async () => {
		stream([
			{ pos: 1, at: RUN_START, kind: 'plan', text: `planned #${ISSUE}` },
			{ pos: 2, at: RUN_START, kind: 'merge', text: '#3027 merged' },
		])

		await run_step_cli.run([ISSUE])

		expect(printed_lines()[0]).toBe(run_step.IMPLEMENT)
	})

	it('prints the lane:plan command right under implement', async () => {
		lane_plan_line_mock.mockResolvedValue(LANE_PLAN_LINE)

		await run_step_cli.run([ISSUE])

		expect(printed_lines().slice(0, 2)).toStrictEqual([run_step.IMPLEMENT, LANE_PLAN_LINE])
		expect(lane_plan_line_mock).toHaveBeenCalledWith(ISSUE, true)
	})

	// joshuafolkken/kit#5016: the whole chain under implement led a lane child into step 1's main:merge.
	it('prints its own step of the chain under implement, never the main:merge step', async () => {
		await run_step_cli.run([ISSUE])

		expect(printed_lines().join('\n')).toContain('0. **A lane child**')
		expect(printed_lines().join('\n')).not.toContain('1. Run `pnpm josh main:merge`.')
	})

	it('prints no lane:plan command away from implement', async () => {
		lane_plan_line_mock.mockResolvedValue(LANE_PLAN_LINE)
		stream([{ pos: 1, at: RUN_START, kind: 'ship-stop', text: `#${ISSUE} gate failed` }])

		await run_step_cli.run([ISSUE])

		expect(printed_lines()[0]).toBe(`pnpm josh ship --log ${ISSUE}`)
		expect(printed_lines()).not.toContain(LANE_PLAN_LINE)
		expect(lane_plan_line_mock).not.toHaveBeenCalled()
	})
})
