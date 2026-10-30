import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state, type LaneState, type LaneStateRecord } from '#scripts/lane/lane-state'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_room } from './lane-room'

// joshuafolkken/kit#4241: the paused-lane check blocked `run:board`'s event loop with one synchronous
// spawn per lane process; the count now reads one asynchronous `ps` whatever the lane count.
// joshuafolkken/kit#4245: the idle-lane check reads that same `ps` rather than a `pgrep` per lane.
// joshuafolkken/kit#4270: paused is the lane state record's answer, never the `ps` state.

const sync_spawn = vi.hoisted(() => ({
	execFileSync: vi.fn(),
	execSync: vi.fn(),
	spawnSync: vi.fn(),
}))
const run_ps = vi.hoisted(() => vi.fn<() => Promise<{ stdout: string }>>())

vi.mock('node:child_process', async (original) => ({
	...(await original<Record<string, unknown>>()),
	...sync_spawn,
}))
vi.mock('execa', () => ({ execa: run_ps }))

const PAUSED = '4173'
const RUNNING = '4174'
const IDLE = '4175'
const REPOSITORY = '/repo/.git'
const STOPPED_PID = 70_001
const RUNNING_PID = 70_002

function lane_of(issue: string): LaneInfo {
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

const LANES = [lane_of(PAUSED), lane_of(RUNNING)]
const START = 'Tue Oct 20 08:39:04 2026'

const LISTING = [
	`${String(process.pid)} 1 0:00.01 4 S ${START} node run-board`,
	`${String(STOPPED_PID)} 1 0:00.01 4 TN ${START} claude -p fullrun #${PAUSED}`,
	`${String(STOPPED_PID + 2)} ${String(STOPPED_PID)} 0:00.01 4 T ${START} node gate`,
	`${String(RUNNING_PID)} 1 0:00.01 4 S ${START} claude -p fullrun #${RUNNING}`,
].join('\n')

function expect_no_sync_spawn(): void {
	expect(sync_spawn.execFileSync).not.toHaveBeenCalled()
	expect(sync_spawn.execSync).not.toHaveBeenCalled()
	expect(sync_spawn.spawnSync).not.toHaveBeenCalled()
}

function record_of(issue: string, state: LaneState): LaneStateRecord {
	return { issue, state, changed_at: '2026-10-20T01:28:00.000Z', changed_by: `lane:${state}` }
}

function arrange_records(records: ReadonlyArray<LaneStateRecord>): void {
	vi.spyOn(lane_state, 'read_states').mockResolvedValue(
		new Map(records.map((record) => [record.issue, record])),
	)
}

beforeEach(() => {
	arrange_records([record_of(PAUSED, 'paused'), record_of(RUNNING, 'running')])
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('lane_room.read — the lane state record', () => {
	it('counts a lane whose processes are stopped but whose record is running', async () => {
		arrange_records([record_of(PAUSED, 'running'), record_of(RUNNING, 'running')])

		const room = await lane_room.read(LANES, async () => lane_process_table.parse(LISTING))

		expect(room.occupied.map((lane) => lane.issue)).toEqual([PAUSED, RUNNING])
		expect(room.unknown).toEqual([])
	})

	it('counts a lane with no record as holding a place, and names it unknown', async () => {
		arrange_records([record_of(RUNNING, 'running')])

		const room = await lane_room.read(LANES, async () => lane_process_table.parse(LISTING))

		expect(room.occupied.map((lane) => lane.issue)).toEqual([PAUSED, RUNNING])
		expect(room.unknown).toEqual([PAUSED])
		expect(room.use.unknown).toEqual([PAUSED])
	})
})

describe('lane_room.read', () => {
	it('reads one asynchronous `ps` and no synchronous spawn, leaving the lane recorded paused uncounted', async () => {
		vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue(LANES)
		run_ps.mockResolvedValue({ stdout: LISTING })

		const room = await lane_room.read(LANES)

		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(room.idle).toEqual([])
		expect(run_ps).toHaveBeenCalledTimes(1)
		expect_no_sync_spawn()
	})

	// joshuafolkken/kit#4245: whether a lane is idle is read from the same snapshot, with no `pgrep`.
	it('reads an idle lane from the same snapshot, with no synchronous spawn and no second `ps`', async () => {
		const lanes = [...LANES, lane_of(IDLE)]

		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
		const ship = vi.spyOn(run_ship_detach, 'read_result').mockReturnValue(undefined)

		run_ps.mockResolvedValue({ stdout: LISTING })

		const room = await lane_room.read(lanes)

		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(room.idle).toEqual([IDLE])
		expect(ship).toHaveBeenCalledWith(REPOSITORY, IDLE, expect.any(Function))
		expect(run_ps).toHaveBeenCalledTimes(1)
		expect_no_sync_spawn()
	})

	// joshuafolkken/kit#4246: `run:board` hands over the snapshot its redraw already read.
	it('reads the snapshot it is given rather than a `ps` of its own', async () => {
		const room = await lane_room.read(LANES, async () => lane_process_table.parse(LISTING))

		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(run_ps).not.toHaveBeenCalled()
	})

	it('counts every lane not recorded paused, none idle, when the snapshot could not be read', async () => {
		run_ps.mockRejectedValue(new Error('ps failed'))

		const room = await lane_room.read(LANES)

		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(room.idle).toEqual([])
		expect_no_sync_spawn()
	})
})
