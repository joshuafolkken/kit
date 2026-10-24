import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_wake } from '#scripts/run/wake/run-wake'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_operation_read } from './run-board-operation-read'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

const MINUTE_MS = 60_000

// joshuafolkken/kit#3439: the board reads the running run, else the one that last ended, and keeps the
// next run's events off an ended run's board.

const { AFTER, CARRY, ENDED_AT, INSIDE, LANE_LIMIT, REPOSITORY, arrange, lane } =
	run_board_read_fixture
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431 --only'
const STOPPED: EndedRun = {
	invocation: EPIC_RUN,
	started_at: STARTED_AT,
	ended_at: ENDED_AT,
	stopped: 'decision',
	session: 'abc',
}

const TRANSCRIPT = '/home/.claude/projects/kit/session.jsonl'
const LANE_LOG = '/logs/josh-lane-dispatch-3432.log'
// Three lanes allowed and one open: two more may open.
const FREE_LANES = 2

afterEach(() => {
	vi.restoreAllMocks()
})

// The one lane against the limit, as `lane:limit` counts it — this run's, no earlier run's among them.
const LANE_ROOM = {
	free_lanes: FREE_LANES,
	lane_limit: LANE_LIMIT,
	occupied_count: 1,
	earlier_occupied: [],
}
// An ended run with no record to resume from and no wake stamp: no session and no process named.
const UNRECORDED = {
	resume: undefined,
	roots: { supervisor: undefined, parent: undefined },
	stuck: new Map(),
	closing: new Set(),
	carry: undefined,
}
const STUCK_PID = 20_611
const STUCK_REASON = 'owned by root'

// joshuafolkken/kit#4300: a process a close could not end is named on the board with why, until a
// retried close ends its lane.
describe('run_board_read.read_local — the processes a close could not end', () => {
	it('reads them off the records of the lanes not yet ended', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		const stuck = [{ pid: STUCK_PID, reason: STUCK_REASON }]
		const record = { issue: '3433', changed_at: STARTED_AT, changed_by: 'lane:open', stuck }

		vi.spyOn(lane_state, 'read_records').mockResolvedValue([
			{ ...record, state: 'open' },
			{ ...record, issue: '3434', state: 'ended', stuck: [{ pid: 1, reason: 'gone' }] },
		])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			closing: new Set(['3433']),
			stuck: new Map([[STUCK_PID, STUCK_REASON]]),
		})
	})
})

// joshuafolkken/kit#4206: the declared order a queued row waits on is read off the running run's record.
describe('run_board_read.read_local — the run’s record', () => {
	it('reads the running run’s record beside it', async () => {
		arrange({ kind: 'carried', carry: CARRY }, undefined)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ carry: CARRY })
	})
})

// joshuafolkken/kit#3697: whether anything still drives the run is read beside it.
describe('run_board_read.read_local — whether the run is stranded', () => {
	it('reads whether the run is stranded from the run’s own records', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		const is_stranded_at = vi.spyOn(run_stranded_detect, 'is_stranded_at').mockReturnValue(true)

		await expect(run_board_read.read_local()).resolves.toMatchObject({ is_stranded: true })
		expect(is_stranded_at).toHaveBeenCalledWith(REPOSITORY, expect.any(Object))
	})
})

describe('run_board_read.read_local', () => {
	it('reads the ended run with its end, its scope and only the events inside it', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })

		await expect(run_board_read.read_local()).resolves.toStrictEqual({
			started_ms: Date.parse(STARTED_AT),
			ended_ms: Date.parse(ENDED_AT),
			scope: { issues: [3431], only: true },
			events: [INSIDE],
			found: new Map(),
			lanes: ['3432'],
			...UNRECORDED,
			is_stranded: false,
			operations: { lanes: [], owner: undefined, judgment: undefined },
			// joshuafolkken/kit#4269: the open lane has no record, so it is unknown.
			lane_states: { own: new Map(), earlier: new Map(), unknown: ['3432'] },
			idle_lanes: [],
			...LANE_ROOM,
			usual: new Map(),
			is_memory_held: false,
		})
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
		// joshuafolkken/kit#4245: traced from the board's one process snapshot, not a pgrep per lane.
		expect(idle_lanes.mock.calls.map(([lanes]) => lanes)).toContainEqual([lane('3432')])
	})
})

const EARLIER_AT = '2026-10-08T08:00:00.000Z'

// A lane's lane state record: running, launched by the run that started at `run_started_at`.
function record_of(issue: string, run_started_at: string): LaneStateRecord {
	return {
		issue,
		run: { started_at: run_started_at },
		state: 'running',
		launched_at: run_started_at,
		changed_at: run_started_at,
		changed_by: 'lane:dispatch',
	}
}

function arrange_states(records: ReadonlyArray<LaneStateRecord>): void {
	const by_issue = new Map(records.map((record) => [record.issue, record]))

	vi.mocked(lane_state.read_states).mockResolvedValue(by_issue)
}

// joshuafolkken/kit#3969, #4269: a lane an earlier run left behind was drawn as this run's child.
describe('run_board_read.read_local lane states', () => {
	it('sorts the open lanes by their records into this run’s, an earlier run’s and unknown', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([
			lane('3431'),
			lane('3432'),
			lane('3433'),
		])
		arrange_states([record_of('3431', EARLIER_AT), record_of('3432', STARTED_AT)])

		const { lane_states } = (await run_board_read.read_local()) ?? {}

		expect(lane_states?.earlier.has(3431)).toBe(true)
		expect(lane_states?.own.has(3432)).toBe(true)
		expect(lane_states?.unknown).toStrictEqual(['3433'])
	})

	// joshuafolkken/kit#4260: its launch is before the span, so the span's events alone hold none of it.
	it('reads what an earlier lane is doing from its launch before the span', async () => {
		const launch: RunEvent = {
			pos: 1,
			at: EARLIER_AT,
			kind: 'child-launch',
			text: '#3431 launched',
		}

		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		vi.mocked(run_event_stream.read_events).mockReturnValue([launch])
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane('3431')])
		arrange_states([record_of('3431', EARLIER_AT)])

		const local = await run_board_read.read_local()

		expect(local?.events).toStrictEqual([])
		expect(local?.lane_states.earlier.get(3431)).toMatchObject({
			state: 'running',
			started_ms: Date.parse(launch.at),
		})
	})
})

function arrange_earlier(idle: Array<string>): void {
	arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane('3430'), lane('3431'), lane('3432')])
	arrange_states([
		record_of('3430', EARLIER_AT),
		record_of('3431', EARLIER_AT),
		record_of('3432', STARTED_AT),
	])
	vi.mocked(lane_spent.idle_lanes).mockReturnValue(idle)
}

// joshuafolkken/kit#4200: an earlier run's lane that holds a place was counted but never drawn.
describe('run_board_read.read_local earlier lanes holding a place', () => {
	it('names the earlier run’s lanes the limit counts, beside the count itself', async () => {
		arrange_earlier([])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			earlier_occupied: ['3430', '3431'],
			occupied_count: 3,
		})
	})

	it('leaves out an earlier run’s lane no child is working in', async () => {
		arrange_earlier(['3430'])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			earlier_occupied: ['3431'],
			occupied_count: 2,
		})
	})
})
