import { describe, expect, it } from 'vitest'
import { run_board_gather_thread } from './run-board-gather-thread'
import { run_board_worker_limits } from './run-board-worker-limits'

// joshuafolkken/kit#8343: the live board's gather worker is started under a heap cap taken from the
// worker heap `run:board --timing` measured.

const { WORKER_LIMITS } = run_board_worker_limits
const { worker_options } = run_board_gather_thread

describe('run_board_worker_limits.WORKER_LIMITS', () => {
	it('caps the old and the young generation at the measured values', () => {
		expect(WORKER_LIMITS).toStrictEqual({
			maxOldGenerationSizeMb: 512,
			maxYoungGenerationSizeMb: 16,
		})
	})
})

describe('run_board_gather_thread.worker_options under the heap cap', () => {
	it('starts the worker with the heap cap', () => {
		expect(worker_options([]).resourceLimits).toBe(WORKER_LIMITS)
	})
})
