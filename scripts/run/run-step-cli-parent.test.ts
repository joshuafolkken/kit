import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_step } from './run-step'

// joshuafolkken/kit#3665: a `backlogrun` that dispatched nothing has no issue to ask about, so the bare
// `run:step` answers for the carry record the session drives rather than failing on its usage.

const read_carry_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
// The session's own process ancestry, which the record's owner is checked against.
const ancestry_mock = vi.hoisted(() => vi.fn((): ReadonlySet<number> => new Set()))
const lane_child_mock = vi.hoisted(() => vi.fn(() => false))

vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { parse_number: () => undefined, gather: gather_mock, to_parts: vi.fn() },
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

vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { own_ancestry: ancestry_mock } }))
// Mocked so a test run from inside a lane worktree does not read itself as a lane child.
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: lane_child_mock, marked_issue: () => undefined },
}))

const { run_step_cli } = await import('./run-step-cli')

const SUCCESS = 0
const FAILURE = 1
const OWNER_PID = 4242
const RUN_START = '2026-10-11T02:49:50.000Z'
const BEFORE_RUN = '2026-10-10T18:00:00.000Z'
const BEGUN = { kind: 'carried', carry: { started_at: RUN_START, owner_pid: OWNER_PID } }
const info_mock = vi.fn()
const error_mock = vi.fn()

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function stream(events: ReadonlyArray<RunEvent>): void {
	vi.spyOn(run_event_stream, 'read_events').mockReturnValue([...events])
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	vi.stubEnv('JOSH_RUN_HEADLESS', '')
	vi.stubEnv('JOSH_RETROSPECTIVE', 'on')
	read_carry_mock.mockReturnValue(BEGUN)
	ancestry_mock.mockReturnValue(new Set([OWNER_PID]))
	lane_child_mock.mockReturnValue(false)
	stream([])
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	info_mock.mockReset()
	error_mock.mockReset()
	gather_mock.mockReset()
})

describe('run_step_cli.run — no issue number, the record this session began', () => {
	it('prints the hand-off though nothing was dispatched, reading no issue', async () => {
		expect(await run_step_cli.run([])).toBe(SUCCESS)
		expect(printed()).toBe(run_step.HAND_OFF_COMMAND)
		expect(gather_mock).not.toHaveBeenCalled()
	})

	it('fires the owed retrospective at this invocation’s drain', async () => {
		stream([{ pos: 1, at: RUN_START, kind: run_event_stream.EVENT_KIND.DRAIN, text: '' }])

		await run_step_cli.run([])

		expect(printed()).toBe(run_step.RETROSPECTIVE_COMMAND)
	})

	it('ignores a drain a previous invocation left on the stream', async () => {
		stream([{ pos: 1, at: BEFORE_RUN, kind: run_event_stream.EVENT_KIND.DRAIN, text: '' }])

		await run_step_cli.run([])

		expect(printed()).toBe(run_step.HAND_OFF_COMMAND)
	})
})

describe('run_step_cli.run — no issue number, nothing this session drives', () => {
	it('answers unknown with the usage when another session owns the record', async () => {
		ancestry_mock.mockReturnValue(new Set())

		expect(await run_step_cli.run([])).toBe(FAILURE)
		expect(printed()).toBe(run_step.UNKNOWN)
		expect(error_mock).toHaveBeenCalledOnce()
	})

	it('answers unknown when there is no carry record', async () => {
		read_carry_mock.mockReturnValue({ kind: 'none' })

		expect(await run_step_cli.run([])).toBe(FAILURE)
		expect(printed()).toBe(run_step.UNKNOWN)
	})

	it('never hands a lane child the parent’s record', async () => {
		lane_child_mock.mockReturnValue(true)

		expect(await run_step_cli.run([])).toBe(FAILURE)
		expect(printed()).toBe(run_step.UNKNOWN)
	})
})
