import { process_identity } from '#scripts/josh/process-identity'
import { PROCESS_ALIVE, PROCESS_NONE, PROCESS_UNKNOWN } from '#scripts/run/run-liveness'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_handoff } from './lane-handoff'
import { lane_process_table, type ProcessTable } from './lane-process-table'
import { lane_snapshot_trace } from './lane-snapshot-trace'

// joshuafolkken/kit#4245: a lane's process trace is answered from one process snapshot, with the same
// three answers `lane_await.process_trace_default`'s `pgrep` gives.

const WORKING = '4245'
const REVIEWED = '4246'
const SHIPPING = '4247'
const IDLE = '4248'
const START = 'Tue Oct 20 08:39:04 2026'
const LISTED_PID = 502

const ROWS = lane_process_table.parse(
	[
		`500 1 0:00.01 4 S ${START} claude -p fullrun #${WORKING}`,
		`501 1 0:00.01 4 S ${START} claude -p the reviewer of lane #${REVIEWED}`,
		`502 1 0:00.01 4 S ${START} node gate`,
	].join('\n'),
)

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_snapshot_trace.traces_of', () => {
	it('reads a lane whose child or reviewer is listed as alive, and one with neither as none', async () => {
		vi.spyOn(lane_handoff, 'ship_reader').mockResolvedValue(() => false)

		const trace = await lane_snapshot_trace.traces_of([WORKING, REVIEWED, IDLE], ROWS)

		expect([trace(WORKING), trace(REVIEWED), trace(IDLE)]).toEqual([
			PROCESS_ALIVE,
			PROCESS_ALIVE,
			PROCESS_NONE,
		])
	})

	it('reads a lane whose detached ship is running as alive, asking about the unmatched lanes alone', async () => {
		const is_shipping = vi.fn((issue: string) => issue === SHIPPING)
		const reader = vi.spyOn(lane_handoff, 'ship_reader').mockResolvedValue(is_shipping)

		const trace = await lane_snapshot_trace.traces_of([WORKING, SHIPPING, IDLE], ROWS)

		expect([trace(SHIPPING), trace(IDLE)]).toEqual([PROCESS_ALIVE, PROCESS_NONE])
		expect(reader).toHaveBeenCalledWith(expect.any(Function))
		expect(is_shipping.mock.calls).toEqual([[SHIPPING], [IDLE]])
	})

	it('reads no ship record when every lane is matched', async () => {
		const reader = vi.spyOn(lane_handoff, 'ship_reader')

		const trace = await lane_snapshot_trace.traces_of([WORKING], ROWS)

		expect(trace(WORKING)).toBe(PROCESS_ALIVE)
		expect(reader).not.toHaveBeenCalled()
	})

	it('reads every lane as unknown when the snapshot could not be read', async () => {
		const reader = vi.spyOn(lane_handoff, 'ship_reader')

		const trace = await lane_snapshot_trace.traces_of([WORKING, IDLE], undefined)

		expect([trace(WORKING), trace(IDLE)]).toEqual([PROCESS_UNKNOWN, PROCESS_UNKNOWN])
		expect(reader).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4466: a lane whose detached ship waits on its merge holds no place, read only where
// the snapshot lists that ship's supervisor.
const SHIP_ROWS = lane_process_table.parse(
	`503 1 0:00.01 4 S ${START} node /usr/local/bin/pnpm josh ship Finish #${SHIPPING}`,
)

async function ship_table(): Promise<ProcessTable | undefined> {
	return SHIP_ROWS
}

async function unread_table(): Promise<undefined> {
	await Promise.resolve(undefined)
}

describe('lane_snapshot_trace.merge_waits_of', () => {
	it('reads the merge wait of a lane whose ship supervisor is listed', async () => {
		const reader = vi
			.spyOn(lane_handoff, 'merge_wait_reader')
			.mockResolvedValue((issue) => issue === SHIPPING)

		const is_waiting = await lane_snapshot_trace.merge_waits_of([WORKING, SHIPPING], SHIP_ROWS)

		expect([is_waiting(WORKING), is_waiting(SHIPPING)]).toEqual([false, true])
		expect(reader).toHaveBeenCalledWith(expect.any(Function))
	})

	it.each([
		['no ship supervisor is listed', ROWS],
		['the snapshot could not be read', undefined],
	])('reads no ship record when %s', async (_case, rows) => {
		const reader = vi.spyOn(lane_handoff, 'merge_wait_reader')

		const is_waiting = await lane_snapshot_trace.merge_waits_of([WORKING, SHIPPING], rows)

		expect(is_waiting(SHIPPING)).toBe(false)
		expect(reader).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4466: the named-epic offer discounts the `in-progress` holders waiting on a merge.
describe('lane_snapshot_trace.count_merge_waiting', () => {
	it('counts the issues whose ship waits on its merge, from the snapshot it reads', async () => {
		vi.spyOn(lane_handoff, 'merge_wait_reader').mockResolvedValue((issue) => issue === SHIPPING)

		const count = await lane_snapshot_trace.count_merge_waiting([WORKING, SHIPPING], ship_table)

		expect(count).toBe(1)
	})

	it('counts none when the snapshot could not be read', async () => {
		const count = await lane_snapshot_trace.count_merge_waiting([SHIPPING], unread_table)

		expect(count).toBe(0)
	})
})

describe('lane_snapshot_trace.traces_of start reader', () => {
	it('hands the ship reader start times answered from the snapshot, starting no `ps`', async () => {
		vi.spyOn(process_identity.START_PROBES, 'read_proc_start').mockReturnValue(undefined)
		const own_ps = vi.spyOn(process_identity.START_PROBES, 'read_ps_start')
		const reader = vi.spyOn(lane_handoff, 'ship_reader').mockResolvedValue(() => false)

		await lane_snapshot_trace.traces_of([IDLE], ROWS)

		const [read] = reader.mock.calls[0] ?? []

		expect(read?.(LISTED_PID)).toBe(START)
		expect(own_ps).not.toHaveBeenCalled()
	})
})
