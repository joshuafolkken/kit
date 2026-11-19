import { setTimeout as sleep } from 'node:timers/promises'
import { parentPort, workerData, type MessagePort } from 'node:worker_threads'
import { poll } from '#scripts/lib/poll'
import { run_board_data_ports } from './run-board-data-ports'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_gather_thread, type RoundState } from './run-board-gather-thread'
import { run_board_spin } from './run-board-spin'

// The live board's worker thread: one round a redraw apart of the reads off this machine, with the
// GitHub, roster and snapshot data stepped over them, each handed to the board as it lands
// (`run-board-gather-thread.ts`). A round that throws is handed over as failed, and the next round
// reads again; a worker started again begins from the data the last one handed over.

const { first_round, gather_round } = run_board_gather_thread

async function gather_forever(port: MessagePort, seed: unknown): Promise<void> {
	const ports = { ...run_board_gather_live.ports_of(true), ...run_board_data_ports.live() }
	let state: RoundState = first_round(seed)

	await poll.wait_for(
		async () => {
			// eslint-disable-next-line require-atomic-updates -- poll awaits each callback before starting the next gather
			state = await gather_round(state, ports, (value) => {
				port.postMessage(value)
			})
		},
		{ interval_ms: run_board_spin.REDRAW_MS, sleeper: sleep },
	)
}

if (parentPort !== null) await gather_forever(parentPort, workerData)
