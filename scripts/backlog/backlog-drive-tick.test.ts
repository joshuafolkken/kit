import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_process_table, type ProcessTable } from '#scripts/lane/lane-process-table'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_arrival_added } from './backlog-arrival-added'
import { backlog_drive_tick } from './backlog-drive-tick'

// joshuafolkken/kit#7016: one process table read per tick answers every in-flight child, with the
// answers the per-issue `pgrep` probe gives.

const ALIVE = '7101'
const GONE = '7102'
const ADOPTED = '7103'

const ROWS = lane_process_table.parse(
	`500 1 0:00.01 4 S Tue Nov 10 08:39:04 2026 claude -p fullrun #${ALIVE}`,
)

beforeEach(() => {
	vi.spyOn(lane_handoff, 'ship_reader').mockResolvedValue(() => false)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function table_of(
	rows: ProcessTable | undefined,
): ReturnType<typeof vi.fn<() => Promise<ProcessTable | undefined>>> {
	return vi.fn(async () => await rows)
}

describe('backlog_drive_tick.liveness', () => {
	it('reads the process table once for every in-flight child of a tick', async () => {
		const table = table_of(ROWS)
		const probe = vi.fn(() => true)
		const lanes = backlog_drive_tick.liveness(table, probe)

		await lanes.take([ALIVE, GONE])

		expect([lanes.is_running(ALIVE), lanes.is_running(GONE)]).toStrictEqual([true, false])
		expect(table).toHaveBeenCalledTimes(1)
		expect(probe).not.toHaveBeenCalled()
	})

	it('reads the table again on the next tick', async () => {
		const table = table_of(ROWS)
		const lanes = backlog_drive_tick.liveness(table, () => true)

		await lanes.take([ALIVE])
		await lanes.take([ALIVE])

		expect(table).toHaveBeenCalledTimes(2)
	})

	it('reads no process table on a tick with no child in flight', async () => {
		const table = table_of(ROWS)
		const lanes = backlog_drive_tick.liveness(table, () => true)

		await lanes.take([])

		expect(table).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_tick.liveness fallback', () => {
	it('asks the per-issue probe for a child the snapshot does not cover', async () => {
		const probe = vi.fn(() => true)
		const lanes = backlog_drive_tick.liveness(table_of(ROWS), probe)

		await lanes.take([ALIVE])

		expect(lanes.is_running(ADOPTED)).toBe(true)
		expect(probe).toHaveBeenCalledWith(ADOPTED)
	})

	it('asks the per-issue probe when the table could not be read', async () => {
		const probe = vi.fn(() => false)
		const lanes = backlog_drive_tick.liveness(table_of(undefined), probe)

		await lanes.take([ALIVE])

		expect(lanes.is_running(ALIVE)).toBe(false)
		expect(probe).toHaveBeenCalledWith(ALIVE)
	})
})

describe('backlog_drive_tick.tick_share', () => {
	it('starts a fresh stream read and takes the snapshot of the lanes in flight', async () => {
		const take = vi.fn(async () => await undefined)
		const stream_read = vi.fn(async () => [])
		const stream_begin = vi.fn()
		const share = backlog_drive_tick.tick_share({
			lanes: { is_running: () => true, take },
			stream: { read: stream_read, begin_tick: stream_begin },
		})

		await share.begin_tick([ALIVE])

		expect(stream_begin).toHaveBeenCalledTimes(1)
		expect(take).toHaveBeenCalledWith([ALIVE])
		expect(share.read).toBe(stream_read)
	})
})

describe('backlog_drive_tick.tick_share defaults', () => {
	it.each([undefined, {}])('uses the default readers for %s', async (options) => {
		const table = vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(ROWS)
		const stream = vi.spyOn(backlog_arrival_added, 'tick_reader')
		const share = backlog_drive_tick.tick_share(options)

		await share.begin_tick([ALIVE])

		expect(share.is_running(ALIVE)).toBe(true)
		expect(table).toHaveBeenCalledOnce()
		expect(stream).toHaveBeenCalledOnce()
	})

	it('defaults the stream when only lanes are supplied', async () => {
		const take = vi.fn(async () => undefined)
		const stream = vi.spyOn(backlog_arrival_added, 'tick_reader')
		const share = backlog_drive_tick.tick_share({ lanes: { is_running: () => true, take } })

		await share.begin_tick([ALIVE])

		expect(take).toHaveBeenCalledExactlyOnceWith([ALIVE])
		expect(stream).toHaveBeenCalledOnce()
	})

	it('defaults lanes when only the stream is supplied', async () => {
		const table = vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(ROWS)
		const stream = { read: vi.fn(async () => []), begin_tick: vi.fn() }
		const share = backlog_drive_tick.tick_share({ stream })

		await share.begin_tick([ALIVE])

		expect(table).toHaveBeenCalledOnce()
		expect(stream.begin_tick).toHaveBeenCalledOnce()
		expect(share.read).toBe(stream.read)
	})
})
