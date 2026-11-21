import { getHeapStatistics } from 'node:v8'
import { Worker } from 'node:worker_threads'

// `josh run:board --timing` (joshuafolkken/kit#8339): how much heap the main thread's isolate and the
// gather worker's use and hold, sampled every `SAMPLE_MS` while a live board is up, said as the latest
// sample and the peak of each. Nothing is sampled without `--timing`.

const SAMPLE_MS = 1000
const BYTES_PER_MB = 1_048_576
const MAIN_ROW = 'main heap'
const WORKER_ROW = 'worker heap'

// The two `v8.getHeapStatistics()` fields the report says: the heap in use and the heap allocated.
interface HeapStats {
	used_heap_size: number
	total_heap_size: number
}

interface HeapFold {
	latest: HeapStats
	peak: HeapStats
}

// The worker's heap, read from the main thread; none before a worker is started.
type WorkerHeap = () => Promise<HeapStats | undefined>

// The main thread's heap, the worker's, and the sampling timer — the process's own outside tests.
interface HeapProbes {
	main: () => HeapStats
	worker: WorkerHeap | undefined
	every: (ms: number, probe: () => void) => () => void
}

interface HeapWatch {
	rows: () => Array<[string, string]>
	stop: () => void
}

interface Folds {
	main?: HeapFold
	worker?: HeapFold
}

function peak_of(peak: HeapStats, sample: HeapStats): HeapStats {
	return {
		used_heap_size: Math.max(peak.used_heap_size, sample.used_heap_size),
		total_heap_size: Math.max(peak.total_heap_size, sample.total_heap_size),
	}
}

// The latest sample, and each field's peak over every sample so far.
function fold(previous: HeapFold | undefined, sample: HeapStats): HeapFold {
	const latest = { used_heap_size: sample.used_heap_size, total_heap_size: sample.total_heap_size }

	return { latest, peak: previous === undefined ? latest : peak_of(previous.peak, latest) }
}

function mb(bytes: number): string {
	return (bytes / BYTES_PER_MB).toFixed(1)
}

// The heap in use and the heap allocated, each latest with its peak, in MB to a tenth.
function summary({ latest, peak }: HeapFold): string {
	const used = `used ${mb(latest.used_heap_size)} MB (peak ${mb(peak.used_heap_size)})`

	return `${used} · total ${mb(latest.total_heap_size)} MB (peak ${mb(peak.total_heap_size)})`
}

// A row per isolate sampled; one never sampled has no row.
function rows(folds: Folds): Array<[string, string]> {
	const named: Array<[string, HeapFold | undefined]> = [
		[MAIN_ROW, folds.main],
		[WORKER_ROW, folds.worker],
	]

	return named.flatMap(([name, held]): Array<[string, string]> =>
		held === undefined ? [] : [[name, summary(held)]],
	)
}

// A worker read that fails — the worker exited between samples — is skipped.
async function sample_worker(folds: Folds, worker: WorkerHeap): Promise<void> {
	try {
		const stats = await worker()

		if (stats !== undefined) folds.worker = fold(folds.worker, stats)
	} catch {
		// Skipped: the next sample reads the worker again.
	}
}

// Samples both heaps now and every `SAMPLE_MS` until stopped.
function watch(probes: HeapProbes): HeapWatch {
	const folds: Folds = {}
	const { worker } = probes

	function sample(): void {
		folds.main = fold(folds.main, probes.main())
		if (worker !== undefined) void sample_worker(folds, worker)
	}

	sample()

	return { rows: () => rows(folds), stop: probes.every(SAMPLE_MS, sample) }
}

function heap_of(worker: unknown): Promise<HeapStats> | undefined {
	return worker instanceof Worker ? worker.getHeapStatistics() : undefined
}

// The spawn, keeping the worker it started last, and that worker's heap read from the main thread
// (`Worker.getHeapStatistics()`); keeping it reads nothing.
function tracked<Seed, Started>(
	spawn: (seed: Seed) => Started,
): { spawn: (seed: Seed) => Started; heap: WorkerHeap } {
	const held: { worker?: Started } = {}

	return {
		spawn: (seed) => {
			held.worker = spawn(seed)

			return held.worker
		},
		heap: async () => await heap_of(held.worker),
	}
}

const run_board_heap = {
	MAIN_ROW,
	SAMPLE_MS,
	WORKER_ROW,
	fold,
	main: getHeapStatistics,
	rows,
	tracked,
	watch,
}

export { run_board_heap }
export type { HeapFold, HeapProbes, HeapStats, HeapWatch, WorkerHeap }
