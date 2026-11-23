import { thread_entry, type WorkerLaunch } from '#scripts/run/thread-entry'

// Where the live board's worker thread starts from (joshuafolkken/kit#8344), resolved by
// `thread-entry.ts` for a board built into `dist/` and one run from source alike.
const WORKER_SCRIPT = 'scripts/run/board/run-board-gather-worker.ts'
const SOURCE_URL = thread_entry.source_url(WORKER_SCRIPT)

function launch_of(is_bundled: boolean, exec_argv: ReadonlyArray<string>): WorkerLaunch {
	return thread_entry.launch_of(WORKER_SCRIPT, is_bundled, exec_argv)
}

const run_board_worker_entry = { SOURCE_URL, WORKER_SCRIPT, launch_of }

export { run_board_worker_entry }

export { type WorkerLaunch } from '#scripts/run/thread-entry'
