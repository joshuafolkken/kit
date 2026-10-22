import { machine_capacity } from '#scripts/gate/machine-capacity'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { describe, expect, it } from 'vitest'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_read } from './run-board-read'

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

	it('tells the time by the clock and waits the time it is asked', async () => {
		const ports = run_board_gather_live.ports_of(false)
		const before = Date.now()

		await ports.sleep(1)

		expect(ports.now()).toBeGreaterThanOrEqual(before)
	})
})
