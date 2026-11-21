import { fileURLToPath, pathToFileURL } from 'node:url'
import { josh_in_process } from '#scripts/josh/josh-in-process'
import { ts_entry_loader } from '#scripts/run/ts-entry-loader'

// Where the live board's worker thread starts from (joshuafolkken/kit#8344). A board built into `dist/`
// starts the worker's own bundle under plain node, so no tsx and no esbuild service rides along with it;
// a board run from source starts the source worker with the TypeScript loader.
const WORKER_SCRIPT = 'scripts/run/board/run-board-gather-worker.ts'
const PACKAGE_DIRECTORY = fileURLToPath(new URL('../../..', import.meta.url))
const SOURCE_URL = new URL(WORKER_SCRIPT, pathToFileURL(PACKAGE_DIRECTORY))

interface WorkerLaunch {
	url: URL
	exec_argv: Array<string>
}

function launch_of(is_bundled: boolean, exec_argv: ReadonlyArray<string>): WorkerLaunch {
	if (!is_bundled) return { url: SOURCE_URL, exec_argv: ts_entry_loader.loader_argv(exec_argv) }

	const bundle = josh_in_process.bundled_script_path(PACKAGE_DIRECTORY, WORKER_SCRIPT)

	return { url: pathToFileURL(bundle), exec_argv: [...exec_argv] }
}

const run_board_worker_entry = { SOURCE_URL, WORKER_SCRIPT, launch_of }

export { run_board_worker_entry }
export type { WorkerLaunch }
