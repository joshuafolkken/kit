import { fileURLToPath, pathToFileURL } from 'node:url'
import { josh_in_process } from '#scripts/josh/josh-in-process'
import { ts_entry_loader } from '#scripts/run/ts-entry-loader'

// Where a worker thread starts from (joshuafolkken/kit#8344). A command built into `dist/` starts the
// worker's own bundle under plain node, so no tsx and no esbuild service rides along with it; a command
// run from source starts the source worker with the TypeScript loader. Each worker script is listed in
// `build-commands.ts` → `THREAD_SCRIPTS` so the build emits its bundle.
const PACKAGE_DIRECTORY = fileURLToPath(new URL('../..', import.meta.url))

interface WorkerLaunch {
	url: URL
	exec_argv: Array<string>
}

function source_url(script: string): URL {
	return new URL(script, pathToFileURL(PACKAGE_DIRECTORY))
}

function launch_of(
	script: string,
	is_bundled: boolean,
	exec_argv: ReadonlyArray<string>,
): WorkerLaunch {
	if (!is_bundled) {
		return { url: source_url(script), exec_argv: ts_entry_loader.loader_argv(exec_argv) }
	}

	const bundle = josh_in_process.bundled_script_path(PACKAGE_DIRECTORY, script)

	return { url: pathToFileURL(bundle), exec_argv: [...exec_argv] }
}

const thread_entry = { source_url, launch_of }

export { thread_entry }
export type { WorkerLaunch }
