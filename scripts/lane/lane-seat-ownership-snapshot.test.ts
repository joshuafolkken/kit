import { PROCESS_ALIVE, PROCESS_NONE } from '#scripts/run/run-liveness'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lane_listening_ports } from './lane-listening-ports'
import { lane_process_table } from './lane-process-table'
import type { LaneInfo } from './lane-registry'
import { lane_seat_ownership } from './lane-seat-ownership'
import { lane_snapshot_trace } from './lane-snapshot-trace'
import { process_directories } from './process-directories'
import { process_lane_marks } from './process-lane-marks'

const SEATS = 9
const ROOT = '/work/.kit-lanes'

function lane(seat: number): LaneInfo {
	return {
		issue: String(seat),
		branch: `${String(seat)}-lane`,
		directory: `${ROOT}/${String(seat)}`,
		seat,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

beforeEach(() => {
	vi.spyOn(lane_process_table, 'read_table').mockResolvedValue([])
	vi.spyOn(lane_listening_ports, 'read_ports').mockResolvedValue(new Set())
	vi.spyOn(lane_snapshot_trace, 'traces_of').mockResolvedValue(() => PROCESS_NONE)
})

afterEach(() => {
	vi.restoreAllMocks()
})

it('does not reserve nine stopped seats for idle shells or portless resident helpers', async () => {
	const lanes = Array.from({ length: SEATS }, (_unused, index) => lane(index + 1))

	vi.spyOn(process_directories, 'list_all').mockReturnValue(
		new Map(lanes.map((entry, index) => [index + 1, entry.directory])),
	)
	vi.spyOn(process_lane_marks, 'list_all').mockReturnValue(new Map())
	const reading = await lane_seat_ownership.snapshot(lanes.map((entry) => entry.issue))

	expect(lane_seat_ownership.measure(lanes, reading).filter((entry) => entry.seat_held)).toEqual([])
	expect(process_directories.list_all).not.toHaveBeenCalled()
	expect(process_lane_marks.list_all).not.toHaveBeenCalled()
})

it('uses the existing async child and ship trace to protect a running execution owner', async () => {
	vi.mocked(lane_snapshot_trace.traces_of).mockResolvedValue(() => PROCESS_ALIVE)
	const reading = await lane_seat_ownership.snapshot(['1'])

	expect(lane_seat_ownership.measure([lane(1)], reading)[0]?.seat_held).toBe(true)
})

it('refuses a failed async process snapshot', async () => {
	vi.mocked(lane_process_table.read_table).mockResolvedValue(undefined)
	await expect(lane_seat_ownership.snapshot(['1'])).resolves.toBeUndefined()
})
