import { core_budget } from '#scripts/gate/core-budget'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { lane_process_table, type ProcessRow } from '#scripts/lane/lane-process-table'
import { describe, expect, it, vi } from 'vitest'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_read } from './run-board-read'

// Past any platform's pid range, so neither `/proc` nor a live process answers for it.
const ABSENT_PID = 99_999_999
const SNAPSHOT_START = 'Thu Nov 19 05:00:00 2026'
const ROW: ProcessRow = {
	pid: 0,
	parent: 0,
	time: '0:00',
	rss_kb: 0,
	stat: 'S',
	start: '',
	command: 'node',
}

describe('run_board_gather_live.ports_of', () => {
	it('reads this machine with the board readers themselves', () => {
		const ports = run_board_gather_live.ports_of(true)

		expect(ports.read_local).toBe(run_board_read.read_local)
		expect(ports.read_table).toBe(lane_process_table.read_table)
		expect(ports.read_machine).toBe(machine_capacity.read_sample)
	})

	it('says whether it gathers for the live board', () => {
		expect(run_board_gather_live.ports_of(true).is_live).toBe(true)
		expect(run_board_gather_live.ports_of(false).is_live).toBe(false)
	})

	// joshuafolkken/kit#8131: the waits read each claim's start off the round's snapshot, not a `ps`.
	it('reads the waiting claims through the snapshot, or the default reader without one', () => {
		const waits = vi.spyOn(core_budget, 'budget_waits').mockReturnValue([])
		const read_waits = run_board_gather_live.ports_of(true).read_waits ?? vi.fn()

		read_waits([{ ...ROW, pid: ABSENT_PID, start: SNAPSHOT_START }])
		read_waits(undefined)

		const [with_table, without_table] = waits.mock.calls.map(([options]) => options)

		expect(with_table?.read?.(ABSENT_PID)).toBe(SNAPSHOT_START)
		expect(without_table).toStrictEqual({ read: undefined })
		waits.mockRestore()
	})

	it('tells the time by the clock and waits the time it is asked', async () => {
		const ports = run_board_gather_live.ports_of(false)
		const before = Date.now()

		await ports.sleep(1)

		expect(ports.now()).toBeGreaterThanOrEqual(before)
	})
})
