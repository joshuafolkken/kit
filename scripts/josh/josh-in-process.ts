import { realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CommandEntry } from './josh-command-types'

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

// A command marked `is_bundled` is pre-built to `dist/commands/<script basename>.js` by
// `scripts/build/build-commands.ts`. The path is derived here, in a module
// the dispatcher bundle already carries, so the build and the dispatcher cannot name two locations.
function bundled_script_path(package_directory: string, script: string): string {
	const name = `${path.basename(script, TYPESCRIPT_EXTENSION)}${JAVASCRIPT_EXTENSION}`

	return path.join(package_directory, BUNDLED_COMMAND_DIRECTORY, name)
}

// The file this dispatcher imports in its own process, or `undefined` to spawn tsx instead.
// `tsx_arguments` are node flags the script needs *before* its own code runs — today every one of
// them a form of `--env-file`, which has no in-process equivalent that reproduces node's own
// parsing and precedence. Those commands (`doctor`, `latest:scope`, `followup`, `notify`) keep a
// process of their own; each runs at most a few times per run, so none of them is where the cost
// this saves accumulates. Under plain node, which cannot load a `.ts` script at all, only a
// pre-built command runs in-process; every other one keeps spawning tsx.
function in_process_target(
	entry: CommandEntry,
	package_directory: string,
	dispatcher_url: string,
): string | undefined {
	if (entry.script === undefined || entry.tsx_arguments !== undefined) return undefined
	if (is_typescript_dispatcher(dispatcher_url)) return path.join(package_directory, entry.script)

	return entry.is_bundled === true
		? bundled_script_path(package_directory, entry.script)
		: undefined
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
	script_path: string,
	script_arguments: ReadonlyArray<string>,
): Promise<number> {
	const resolved_path = resolve_real_path(script_path)

	process.argv = [process.execPath, resolved_path, ...script_arguments]

	try {
		await import(pathToFileURL(resolved_path).href)
	} catch (error) {
		// A spawned tsx printed the stack and exited 1; the same failure has to look the same here.
		console.error(error)

		return FAILURE_EXIT_CODE
	}

	return read_exit_code()
}

const josh_in_process = { bundled_script_path, in_process_target, run_in_process }

export { BUNDLED_COMMAND_DIRECTORY, FAILURE_EXIT_CODE, josh_in_process }
