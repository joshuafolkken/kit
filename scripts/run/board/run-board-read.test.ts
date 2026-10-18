import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended, type EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_wake } from '#scripts/run/wake/run-wake'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_operation_read } from './run-board-operation-read'
import { run_board_read } from './run-board-read'

const MINUTE_MS = 60_000

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
// Three lanes allowed and one open: two more may open.
const LANE_LIMIT = 3
const FREE_LANES = 2

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
	// The limit is read off the environment and a live run's override: never a real one from a test.
	vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: LANE_LIMIT })
	// Every log is read off the machine: never a real one from a test.
	vi.spyOn(time_density_hook, 'read_tail').mockReturnValue('')
	// Each lane's child is probed with `pgrep`: never a real process from a test.
	vi.spyOn(lane_spent, 'idle_lanes').mockReturnValue([])
	// Each lane's branch and tree are read with git: never a real lane from a test.
	vi.spyOn(lane_vacant, 'vacant_issues').mockResolvedValue([])
}

afterEach(() => {
	vi.restoreAllMocks()
})

// The one lane against the limit, as `lane:limit` counts it.
const LANE_ROOM = { free_lanes: FREE_LANES, lane_limit: LANE_LIMIT, occupied_lanes: ['3432'] }

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
			idle_lanes: [],
			earlier_lanes: [],
			...LANE_ROOM,
			usual: new Map(),
			is_memory_held: false,
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

// joshuafolkken/kit#3769: how long each phase usually takes is read off the repository's ledger.
describe('run_board_read.read_local usual times', () => {
	it('reads each phase’s usual time from the repository’s ledger', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		const stage: LedgerEntry = {
			kind: 'stage',
			at: STARTED_AT,
			stage: 'round-2',
			elapsed_ms: MINUTE_MS,
		}
		const read = vi.spyOn(lane_ledger, 'read_entries').mockReturnValue([stage])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			usual: new Map([['round_two', MINUTE_MS]]),
		})
		expect(read).toHaveBeenCalledWith(lane_ledger.target_of(REPOSITORY))
	})
})

// joshuafolkken/kit#4084: the driver's memory hold is the hold the ledger leaves open.
describe('run_board_read.read_local memory hold', () => {
	const MEMORY_HOLD: LedgerEntry = { kind: 'held', at: STARTED_AT, reason: 'memory' }

	function arrange_ledger(entries: ReadonlyArray<LedgerEntry>): void {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValue(entries)
		// Inside the hold's cap, so the open hold is not read as a driver killed while held.
		vi.spyOn(Date, 'now').mockReturnValue(Date.parse(INSIDE.at))
	}

	it('reads a memory hold the ledger leaves open', async () => {
		arrange_ledger([MEMORY_HOLD])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ is_memory_held: true })
	})

	it('reads no memory hold once a dispatch ended it', async () => {
		arrange_ledger([MEMORY_HOLD, { kind: 'dispatch', at: ENDED_AT, issue: 1 }])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ is_memory_held: false })
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

// joshuafolkken/kit#3750: a waiting row says no lane is free, so the count is read beside the lanes.
describe('run_board_read.read_local free lanes', () => {
	it('counts the lanes the limit still allows, a stranded lane holding none', async () => {
		const stranded = { ...lane('3433'), is_stranded: true }

		arrange(NONE, STOPPED)
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane('3432'), stranded])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ free_lanes: FREE_LANES })
	})

	it('reads no count where the limit is not a number anyone set', async () => {
		arrange(NONE, STOPPED)
		vi.mocked(lane_capacity.lane_limit).mockResolvedValue({ kind: 'problem', problem: 'bad' })

		await expect(run_board_read.read_local()).resolves.toMatchObject({ free_lanes: undefined })
	})
})

// joshuafolkken/kit#3893: a lane whose child had died was drawn running.
describe('run_board_read.read_local idle lanes', () => {
	it('reads which of its open lanes no child is working in', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		const idle_lanes = vi.mocked(lane_spent.idle_lanes).mockReturnValue(['3432'])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ idle_lanes: ['3432'] })
		expect(idle_lanes).toHaveBeenCalledWith([lane('3432')])
	})
})

// joshuafolkken/kit#3969: a lane an earlier run left behind was drawn as this run's child.
describe('run_board_read.read_local earlier lanes', () => {
	it('names the open lanes that last took a child before the run started', async () => {
		const started_ms = Date.parse(STARTED_AT)

		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([
			{ ...lane('3431'), dispatched_ms: started_ms - MINUTE_MS },
			{ ...lane('3432'), dispatched_ms: started_ms + MINUTE_MS },
			lane('3433'),
		])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ earlier_lanes: ['3431'] })
	})
})
