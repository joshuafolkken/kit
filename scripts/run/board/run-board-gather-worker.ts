import { setTimeout as sleep } from 'node:timers/promises'
import { parentPort, type MessagePort } from 'node:worker_threads'
import { poll } from '#scripts/lib/poll'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_spin } from './run-board-spin'

// The live board's worker thread: one round of the reads off this machine a redraw apart, each handed
// to the board as it lands (`run-board-gather-thread.ts`). A round that throws is handed over as
// failed, and the next round reads again.

const { FRESH_GATHER } = run_board_gather
const { gather_round } = run_board_gather_thread

async function gather_forever(port: MessagePort): Promise<void> {
	const ports = run_board_gather_live.ports_of(true)
	let state = FRESH_GATHER

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

if (parentPort !== null) await gather_forever(parentPort)
