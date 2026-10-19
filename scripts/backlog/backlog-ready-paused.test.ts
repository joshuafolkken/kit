import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_ready } from './backlog-ready'

// joshuafolkken/kit#4241: the paused-lane check blocked `run:board`'s event loop with one synchronous
// spawn per lane process; the count now reads one asynchronous `ps` whatever the lane count.

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

const LISTING = [
	`${String(process.pid)} 1 0:00.01 4 S node run-board`,
	`${String(STOPPED_PID)} 1 0:00.01 4 TN claude -p fullrun #${PAUSED}`,
	`${String(STOPPED_PID + 2)} ${String(STOPPED_PID)} 0:00.01 4 T node gate`,
	`${String(RUNNING_PID)} 1 0:00.01 4 S claude -p fullrun #${RUNNING}`,
].join('\n')

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('backlog_ready.lane_room', () => {
	it('reads one asynchronous `ps` and no synchronous spawn for the paused check, leaving the paused lane uncounted', async () => {
		vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue(LANES)
		vi.spyOn(lane_spent, 'idle_lanes').mockReturnValue([])
		run_ps.mockResolvedValue({ stdout: LISTING })

		const room = await backlog_ready.lane_room(LANES)

		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(run_ps).toHaveBeenCalledTimes(1)
		expect(sync_spawn.execFileSync).not.toHaveBeenCalled()
		expect(sync_spawn.execSync).not.toHaveBeenCalled()
		expect(sync_spawn.spawnSync).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#4246: `run:board` hands over the snapshot its redraw already read.
	it('reads the snapshot it is given rather than a `ps` of its own', async () => {
		vi.spyOn(lane_spent, 'idle_lanes').mockReturnValue([])

		const room = await backlog_ready.lane_room(LANES, async () => lane_process_table.parse(LISTING))

		expect(room.occupied.map((lane) => lane.issue)).toEqual([RUNNING])
		expect(run_ps).not.toHaveBeenCalled()
	})

	it('counts every lane when the snapshot could not be read', async () => {
		vi.spyOn(lane_spent, 'idle_lanes').mockReturnValue([])
		run_ps.mockRejectedValue(new Error('ps failed'))

		const room = await backlog_ready.lane_room(LANES)

		expect(room.occupied).toHaveLength(LANES.length)
	})
})
