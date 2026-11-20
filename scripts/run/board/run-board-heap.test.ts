import { once } from 'node:events'
import { setImmediate as settled } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { run_board_heap, type HeapProbes, type HeapStats } from './run-board-heap'

// joshuafolkken/kit#8339: `run:board --timing` says each isolate's heap, latest and peak.

const { MAIN_ROW, SAMPLE_MS, WORKER_ROW, fold, rows, tracked, watch } = run_board_heap
const MB = 1_048_576

function stats(used_mb: number, total_mb: number): HeapStats {
	return { used_heap_size: used_mb * MB, total_heap_size: total_mb * MB }
}

// Probes whose timer keeps the probe it was handed, so a test runs each sample itself.
function probes(
	main: Array<HeapStats>,
	worker?: HeapProbes['worker'],
): { probes: HeapProbes; tick: () => void; stop: () => void; every: ReturnType<typeof vi.fn> } {
	const held: { probe?: () => void } = {}
	const stop = vi.fn()
	const every = vi.fn((_ms: number, probe: () => void) => {
		held.probe = probe

		return stop
	})

	function read(): HeapStats {
		return main.shift() ?? stats(0, 0)
	}

	return { probes: { main: read, worker, every }, tick: () => held.probe?.(), stop, every }
}

describe('run_board_heap.fold', () => {
	it('takes the first sample as both the latest and the peak', () => {
		expect(fold(undefined, stats(2, 4))).toEqual({ latest: stats(2, 4), peak: stats(2, 4) })
	})

	it('keeps each field at its highest while the latest follows the sample', () => {
		const folded = fold(fold(undefined, stats(5, 6)), stats(3, 8))

		expect(folded).toEqual({ latest: stats(3, 8), peak: stats(5, 8) })
	})
})

describe('run_board_heap.rows', () => {
	it('says used and total in MB, each with its peak', () => {
		const main = fold(fold(undefined, stats(2, 4)), stats(1.5, 3))

		expect(rows({ main })).toEqual([[MAIN_ROW, 'used 1.5 MB (peak 2.0) · total 3.0 MB (peak 4.0)']])
	})

	it('has no row for an isolate never sampled', () => {
		expect(rows({})).toEqual([])
	})
})

describe('run_board_heap.watch', () => {
	it('samples the main heap at once and on every probe, at the sample interval', () => {
		const board = probes([stats(1, 2), stats(3, 4)])
		const heap = watch(board.probes)

		board.tick()

		expect(board.every).toHaveBeenCalledWith(SAMPLE_MS, expect.any(Function))
		expect(heap.rows()).toEqual([[MAIN_ROW, 'used 3.0 MB (peak 3.0) · total 4.0 MB (peak 4.0)']])
	})

	it('samples the worker heap beside it', async () => {
		const heap = watch(probes([stats(1, 2)], async () => await stats(7, 9)).probes)

		await settled()

		expect(heap.rows()[1]).toEqual([WORKER_ROW, 'used 7.0 MB (peak 7.0) · total 9.0 MB (peak 9.0)'])
	})

	it('skips a worker read that fails or has no worker yet', async () => {
		const failing = watch(
			probes([stats(1, 2)], async () => {
				throw new Error('gone')
			}).probes,
		)
		const unstarted = watch(probes([stats(1, 2)], async () => await undefined).probes)

		await settled()

		expect(failing.rows().map(([name]) => name)).toEqual([MAIN_ROW])
		expect(unstarted.rows().map(([name]) => name)).toEqual([MAIN_ROW])
	})

	it('stops the timer it started', () => {
		const board = probes([])

		watch(board.probes).stop()

		expect(board.stop).toHaveBeenCalledOnce()
	})
})

describe('run_board_heap.tracked', () => {
	it('reads no heap before a worker starts, nor from one that is not a thread', async () => {
		const started = tracked((seed: number) => ({ seed }))

		await expect(started.heap()).resolves.toBeUndefined()
		expect(started.spawn(1)).toEqual({ seed: 1 })
		await expect(started.heap()).resolves.toBeUndefined()
	})

	it('reads the heap of the worker thread it started last from the main thread', async () => {
		const started = tracked(() => new Worker('setInterval(() => undefined, 1000)', { eval: true }))
		const worker = started.spawn(undefined)

		try {
			await once(worker, 'online')
			const heap = await started.heap()

			expect(heap?.used_heap_size).toBeGreaterThan(0)
			expect(heap?.total_heap_size).toBeGreaterThan(0)
		} finally {
			await worker.terminate()
		}
	})
})
