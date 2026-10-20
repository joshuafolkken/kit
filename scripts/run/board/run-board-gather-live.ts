import { setTimeout as sleep } from 'node:timers/promises'
import { core_budget } from '#scripts/gate/core-budget'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import type { GatherPorts } from './run-board-gather'
import { run_board_read } from './run-board-read'
import { run_board_usage_read } from './run-board-usage-read'

// The live reads off this machine, shared by the live board's worker thread
// (`run-board-gather-worker.ts`) and the single frame that reads where it draws.

function ports_of(is_live: boolean): GatherPorts {
	return {
		read_table: lane_process_table.read_table,
		read_local: run_board_read.read_local,
		read_machine: machine_capacity.read_sample,
		read_waits: () => core_budget.budget_waits(),
		read_usage: run_board_usage_read.usage_reader(),
		is_live,
		now: () => Date.now(),
		sleep: async (ms) => {
			await sleep(ms)
		},
	}
}

const run_board_gather_live = { ports_of }

export { run_board_gather_live }
