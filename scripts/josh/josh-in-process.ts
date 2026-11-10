import { realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// `pnpm josh <script command>` started tsx twice — once for this dispatcher, once for the script it
// spawned. Measured on 2026-09-04, the second start was about 0.16 s of the 0.55 s a
// `pnpm josh format:edited` took, and the edit/Bash hook pays it 60–90 times in a single run.
// The script is ordinary TypeScript and a TypeScript loader is already
// installed by the time this file runs, so the dispatcher evaluates the script itself instead.
const TYPESCRIPT_EXTENSION = '.ts'
const JAVASCRIPT_EXTENSION = '.js'
const BUNDLED_COMMAND_DIRECTORY = path.join('dist', 'commands')
const FAILURE_EXIT_CODE = 1

// The dispatcher may only load a `.ts` script in its own process when it was itself loaded as
// TypeScript — which is exactly the condition under which a loader capable of it is present. A
// consumer runs the bundled `dist/josh.js` under plain node, whose `import.meta.url` ends in `.js`.
function is_typescript_dispatcher(dispatcher_url: string): boolean {
	return dispatcher_url.endsWith(TYPESCRIPT_EXTENSION)
}

// Every script command is pre-built to `dist/commands/<script basename>.js` by
// `scripts/build/build-commands.ts`. The path is derived here, in a module
// the dispatcher bundle already carries, so the build and the dispatcher cannot name two locations.
function bundled_script_path(package_directory: string, script: string): string {
	const name = `${path.basename(script, TYPESCRIPT_EXTENSION)}${JAVASCRIPT_EXTENSION}`

	return path.join(package_directory, BUNDLED_COMMAND_DIRECTORY, name)
}

// What the dispatcher imports, and the script the command runs as. They differ under plain node,
// which cannot load a `.ts` script at all and imports the pre-built command instead; the build keeps
// every module's `import.meta.url` on its source (`scripts/build/source-location.ts`), so the
// script stays the source either way.
interface InProcessTarget {
	module_path: string
	script_path: string
}

function in_process_target(
	script: string,
	package_directory: string,
	dispatcher_url: string,
): InProcessTarget {
	const script_path = path.join(package_directory, script)
	const module_path = is_typescript_dispatcher(dispatcher_url)
		? script_path
		: bundled_script_path(package_directory, script)

	return { module_path, script_path }
}

// `process.exitCode` is typed `number | string | undefined`. Only the numeric form is an exit code
// this dispatcher can forward, and an unset one means the script finished without asking for one.
function read_exit_code(): number {
	const code = process.exitCode

	return typeof code === 'number' ? code : 0
}

// ESM resolution follows symlinks, so the `import.meta.url` a script's guard compares against is
// its real path. The argv this dispatcher builds has to be that same string: a checkout
// reached through a symlink would otherwise import the script cleanly, run nothing and answer 0. A
// path that cannot be resolved is left as it is, so the import below reports the failure.
function resolve_real_path(script_path: string): string {
	try {
		return realpathSync(script_path)
	} catch {
		return script_path
	}
}

// Every josh script decides whether to run its own main from
// `process.argv[1] === fileURLToPath(import.meta.url)`, so the dispatcher's argv is replaced with
// the one the spawned process would have had before the module is evaluated. It is deliberately not
// restored afterwards: the script is the program from here on, and anything it deferred past module
// evaluation would otherwise read the dispatcher's argv instead of its own.
async function run_in_process(
	target: InProcessTarget,
	script_arguments: ReadonlyArray<string>,
): Promise<number> {
	process.argv = [process.execPath, resolve_real_path(target.script_path), ...script_arguments]

	try {
		await import(pathToFileURL(resolve_real_path(target.module_path)).href)
	} catch (error) {
		// A spawned tsx printed the stack and exited 1; the same failure has to look the same here.
		console.error(error)

		return FAILURE_EXIT_CODE
	}

	return read_exit_code()
}

const josh_in_process = { bundled_script_path, in_process_target, run_in_process }

export type { InProcessTarget }
export { BUNDLED_COMMAND_DIRECTORY, FAILURE_EXIT_CODE, josh_in_process }
