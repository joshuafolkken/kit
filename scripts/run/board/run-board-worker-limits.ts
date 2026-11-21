import type { ResourceLimits } from 'node:worker_threads'

// joshuafolkken/kit#8343: the live board's gather worker runs under a heap cap, so V8 collects rather
// than growing the heap it holds. The values come from `run:board --timing`'s worker heap row
// (joshuafolkken/kit#8339) on a live board during a backlogrun; the measurement is on the Issue.
// A worker past its cap ends with `ERR_WORKER_OUT_OF_MEMORY`, and the board starts the next one on the
// next redraw from the data the last one handed over (`run-board-gather-thread.ts`).

// About twice the worker's peak heap in use (joshuafolkken/kit#8343), so the start-up peak fits.
const MAX_OLD_GENERATION_MB = 512
// The young generation (its semi-spaces), below V8's default.
const MAX_YOUNG_GENERATION_MB = 16

const WORKER_LIMITS: ResourceLimits = {
	maxOldGenerationSizeMb: MAX_OLD_GENERATION_MB,
	maxYoungGenerationSizeMb: MAX_YOUNG_GENERATION_MB,
}

const run_board_worker_limits = { WORKER_LIMITS }

export { run_board_worker_limits }
