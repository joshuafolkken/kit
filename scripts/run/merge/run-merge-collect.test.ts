import { issue_merged } from '#scripts/issue/issue-merged'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_cli } from './run-merge-cli'
import { run_merge_collect } from './run-merge-collect'

// joshuafolkken/kit#3451: a lane that merged while no `backlog:drive` watched it never reached
// `run:merge`. `--end` collects every lane the run launched and never settled — but only a merged one.

vi.mock('#scripts/issue/issue-merged', () => ({ issue_merged: { read_merged: vi.fn() } }))
vi.mock('#scripts/issue/issue-state-cli', () => ({ issue_state_cli: { read_issue: vi.fn() } }))
vi.mock('#scripts/lane/lane-handoff', () => ({ lane_handoff: { is_ship_running: vi.fn() } }))
vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: vi.fn() },
}))
vi.mock('./run-merge-cli', () => ({
	run_merge_cli: { read_merged_pr: vi.fn(), record_merged: vi.fn() },
}))

const DIRECTORY = '/repo/.git'
const AT = '2026-10-08T08:00:00.000Z'
const MERGED_PR = 'https://github.com/joshuafolkken/kit/pull/3453'
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
	owner_pid: 42,
	owner_start: 'start',
}

function lane(issue: string, is_stranded = false): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded,
	}
}

function launch(issue: string, pos: number): RunEvent {
	return { pos, at: AT, kind: run_event_stream.EVENT_KIND.CHILD_LAUNCH, text: `#${issue} launched` }
}

function state_of(state: string): Awaited<ReturnType<typeof issue_state_cli.read_issue>> {
	return { kind: 'state', state: { state, labels: [], is_human_review: false } }
}

const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }

function carried(read: CarryRead = CARRIED): void {
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
}

async function collected(): Promise<Array<unknown>> {
	await run_merge_collect.collect_merged(DIRECTORY)

	return vi.mocked(run_merge_cli.record_merged).mock.calls.map(([ctx]) => ctx)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	carried()
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([
		launch('1', 1),
		launch('2', 2),
	])
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane('1'), lane('2'), lane('9')])
	vi.mocked(lane_handoff.is_ship_running).mockReturnValue(false)
	vi.mocked(issue_state_cli.read_issue).mockResolvedValue(state_of('CLOSED'))
	vi.mocked(issue_merged.read_merged).mockImplementation(async (issue) => issue === '1')
	vi.mocked(run_merge_cli.read_merged_pr).mockResolvedValue(undefined)
	vi.mocked(run_merge_cli.record_merged).mockResolvedValue(undefined)
})

describe('run_merge_collect.collect_merged', () => {
	it('collects a closed in-flight lane that merged, as the record’s owner, and no other', async () => {
		expect(await collected()).toStrictEqual([
			{
				child: '1',
				epic: undefined,
				repo: undefined,
				over: undefined,
				owner: { pid: 42, start: 'start', transcript: undefined },
				merged_pr: undefined,
			},
		])
	})

	it('collects an open lane GitHub left behind a merged pull request, with that pull request', async () => {
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue(state_of('OPEN'))
		vi.mocked(run_merge_cli.read_merged_pr).mockImplementation(async (child) =>
			child === '2' ? MERGED_PR : undefined,
		)

		expect(await collected()).toMatchObject([{ child: '2', merged_pr: MERGED_PR }])
	})

	it('leaves a lane a detached ship still supervises to that ship', async () => {
		vi.mocked(lane_handoff.is_ship_running).mockReturnValue(true)

		expect(await collected()).toStrictEqual([])
	})
})

describe('run_merge_collect.collect_merged — what it leaves alone', () => {
	it('collects nothing without a live record', async () => {
		carried({ kind: 'none' })

		expect(await collected()).toStrictEqual([])
		expect(lane_registry.list_lanes).not.toHaveBeenCalled()
	})

	it('reports a lane that failed to collect and goes on to the next', async () => {
		vi.mocked(issue_merged.read_merged).mockResolvedValue(true)
		vi.mocked(run_merge_cli.record_merged).mockRejectedValueOnce(new Error('main:sync failed'))

		expect(await collected()).toHaveLength(2)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`lane ${session_cite.issue(1)} was not collected`),
		)
	})
})
