import { Worker } from 'node:worker_threads'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_read } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4267: a live board's reads run on its worker thread, so the redraw's own thread
// reads no run stream, no process table and no machine gauge — none of which can then stop a spinner.

const { harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { WORKER_URL, worker_gatherer } = run_board_gather_thread
// The worker starts tsx and takes a first round of real reads before the first frame.
const FIRST_ROUND_MS = 60_000
const workers: Array<Worker> = []

// The test runner loads TypeScript its own way; the worker is handed tsx, as `josh` hands it.
function spawn(): Worker {
	const worker = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] })

	workers.push(worker)

	return worker
}

afterEach(async () => {
	await Promise.all(workers.splice(0).map(async (worker) => await worker.terminate()))
	vi.restoreAllMocks()
})

describe('run_board_gather_thread.worker_gatherer on a real worker', () => {
	it(
		'draws a frame without reading the run, the processes or the machine on its own thread',
		async () => {
			const reads = [
				vi.spyOn(run_board_read, 'read_local'),
				vi.spyOn(lane_process_table, 'read_table'),
				vi.spyOn(machine_capacity, 'read_sample'),
			]
			const { ports, frames } = harness(undefined, [])

			await tick(FRESH_STATE, { ...ports, gather: worker_gatherer(spawn) }, 'background')

			expect(frames).toHaveLength(1)
			expect(frames.join('')).not.toContain('❗')
			for (const read of reads) expect(read).not.toHaveBeenCalled()
		},
		FIRST_ROUND_MS,
	)
})
