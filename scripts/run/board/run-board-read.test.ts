import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended, type EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_wake } from '#scripts/run/wake/run-wake'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_operation_read } from './run-board-operation-read'
import { run_board_read } from './run-board-read'

// joshuafolkken/kit#3439: the board reads the running run, else the one that last ended, and keeps the
// next run's events off an ended run's board.

const REPOSITORY = '/repo/.git'
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const ENDED_AT = '2026-10-08T10:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431 --only'
const INSIDE: RunEvent = {
	pos: 1,
	at: '2026-10-08T09:30:00.000Z',
	kind: 'merge',
	text: '#1 merged',
}
const AFTER: RunEvent = { pos: 2, at: '2026-10-08T10:30:00.000Z', kind: 'merge', text: '#2 merged' }
const STOPPED: EndedRun = {
	invocation: EPIC_RUN,
	started_at: STARTED_AT,
	ended_at: ENDED_AT,
	stopped: 'decision',
	session: 'abc',
}

const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: ENDED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const TRANSCRIPT = '/home/.claude/projects/kit/session.jsonl'
const LANE_LOG = '/logs/josh-lane-dispatch-3432.log'

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

function arrange(read: CarryRead, ended: EndedRun | undefined): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	vi.spyOn(run_carry_ended, 'read_ended').mockReturnValue(ended)
	// The launch record is keyed on the repository and read off the machine: never a real one from a test.
	vi.spyOn(backlogrun_launch, 'pending_launch').mockReturnValue(undefined)
	vi.spyOn(run_event_stream, 'read_events').mockReturnValue([INSIDE, AFTER])
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane('3432')])
	// Every log is read off the machine: never a real one from a test.
	vi.spyOn(time_density_hook, 'read_tail').mockReturnValue('')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local', () => {
	it('reads the ended run with its end, its scope and only the events inside it', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })

		await expect(run_board_read.read_local()).resolves.toStrictEqual({
			started_ms: Date.parse(STARTED_AT),
			ended_ms: Date.parse(ENDED_AT),
			scope: { issues: [3431], only: true },
			events: [INSIDE],
			lanes: ['3432'],
			resume: undefined,
			is_stranded: false,
			operations: { lanes: [], owner: undefined, judgment: undefined },
		})
	})

	// joshuafolkken/kit#3697: whether anything still drives the run is read beside it.
	it('reads whether the run is stranded from the run’s own records', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		const is_stranded_at = vi.spyOn(run_stranded_detect, 'is_stranded_at').mockReturnValue(true)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ is_stranded: true })
		expect(is_stranded_at).toHaveBeenCalledWith(REPOSITORY)
	})

	it('reads nothing when no run has started or ended here', async () => {
		arrange(NONE, undefined)

		await expect(run_board_read.read_local()).resolves.toBeUndefined()
	})

	it('reads nothing outside a git checkout', async () => {
		arrange(NONE, undefined)
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		await expect(run_board_read.read_local()).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#3437: a stopped run offers its session; a run that begins hides it.
describe('run_board_read.read_local resume', () => {
	it('reads the session a stopped run resumes from, only while that run is the one drawn', async () => {
		const running: CarryRead = { kind: 'carried', carry: CARRY }

		arrange(NONE, STOPPED)
		await expect(run_board_read.read_local()).resolves.toMatchObject({ resume: 'abc' })
		vi.mocked(run_carry.read_carry).mockReturnValue(running)
		await expect(run_board_read.read_local()).resolves.toMatchObject({ resume: undefined })
	})
})

// joshuafolkken/kit#3696: a run `josh backlogrun` launched is drawn from its launch record until its
// parent claims the carry record.
describe('run_board_read.read_local with a launch its parent has not claimed', () => {
	it('draws the launch as the run, reading this repository’s launch record', async () => {
		arrange(NONE, undefined)
		const pending = vi
			.mocked(backlogrun_launch.pending_launch)
			.mockReturnValue({ invocation: 'backlogrun', started_at: STARTED_AT })

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			started_ms: Date.parse(STARTED_AT),
			ended_ms: undefined,
			events: [INSIDE, AFTER],
		})
		expect(pending).toHaveBeenCalledExactlyOnceWith(REPOSITORY)
	})

	it('hides the session of the stopped run the launch replaces', async () => {
		arrange(NONE, STOPPED)
		vi.mocked(backlogrun_launch.pending_launch).mockReturnValue({
			invocation: 'backlogrun',
			started_at: AFTER.at,
		})

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			started_ms: Date.parse(AFTER.at),
			ended_ms: undefined,
			resume: undefined,
		})
	})
})

// joshuafolkken/kit#3757: each session's newest operation is read from the log the run names for it.
describe('run_board_read.read_local operations', () => {
	it('reads the lane’s, the parent’s and the watcher’s logs, each in its own checkout', async () => {
		const root = process.cwd()
		const read = vi.spyOn(run_board_operation_read, 'read')

		arrange({ kind: 'carried', carry: { ...CARRY, owner_transcript: TRANSCRIPT } }, undefined)
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([{ ...lane('3432'), output: LANE_LOG }])
		await run_board_read.read_local()

		expect(read).toHaveBeenCalledExactlyOnceWith({
			lanes: [{ issue: '3432', log: LANE_LOG, root: '/lanes/3432' }],
			owner: { log: TRANSCRIPT, root },
			judgment: { log: run_wake.wake_log_path(REPOSITORY), root },
		})
	})
})
