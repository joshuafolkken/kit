import { setTimeout as sleep } from 'node:timers/promises'
import { parentPort, type MessagePort } from 'node:worker_threads'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_live } from './run-board-gather-live'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_spin } from './run-board-spin'

// The live board's worker thread: one round of the reads off this machine a redraw apart, each handed
// to the board as it lands (`run-board-gather-thread.ts`). A read that throws ends the worker, which
// the board says and starts again.

const { FRESH_GATHER, gather } = run_board_gather

async function gather_forever(port: MessagePort): Promise<void> {
	const ports = run_board_gather_live.ports_of(true)
	let state = FRESH_GATHER

	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- polling: each round folds the state the last one left
		const next = await gather(state, ports, 'background')

		port.postMessage(run_board_gather_thread.post_of(state, next))
		state = next
		// eslint-disable-next-line no-await-in-loop -- polling: each round waits a redraw
		await sleep(run_board_spin.REDRAW_MS)
	}
}

if (parentPort !== null) await gather_forever(parentPort)
